import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

test('guarded attendance, enrollment, timetable and MCP approvals in PostgreSQL', async t => {
    if (!dbUrl) return t.skip('DATABASE_URL / SUPABASE_DB_URL not configured; requires a migrated test database.');
    const db = new pg.Client({ connectionString: dbUrl });
    await db.connect();
    const ids = Object.fromEntries(['school', 'otherSchool', 'admin', 'extraAdmin', 'teacher', 'subjectTeacher',
        'otherAdmin', 'student', 'student2', 'foreignStudent', 'schoolless', 'parent', 'year', 'class',
        'otherClass', 'subject', 'session', 'client', 'grant', 'version'].map(key => [key, randomUUID()]));
    const actor = async (id, session = null) => {
        await db.query('RESET ROLE');
        await db.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",
            [JSON.stringify({ sub: id, role: 'authenticated', ...(session ? { session_id: session } : {}) }), id]);
        await db.query('SET LOCAL ROLE authenticated');
    };
    const owner = async () => {
        await db.query('RESET ROLE');
        await db.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub','',true)",
            [JSON.stringify({ role: 'service_role' })]);
    };
    const denied = async (query, params, pattern = /not|only|unavailable|invalid|required|changed|expired|complete|duplicate|outside|school|roster|future|year/i) => {
        await db.query('SAVEPOINT expected_denial');
        try { await assert.rejects(db.query(query, params), pattern); }
        finally {
            await db.query('ROLLBACK TO SAVEPOINT expected_denial');
            await db.query('RELEASE SAVEPOINT expected_denial');
        }
    };
    try {
        await db.query('BEGIN');
        await owner();
        await db.query(`INSERT INTO public.schools(id,name,slug,time_zone,ai_connections_enabled)
            VALUES($1,'Audit Alpha',$3,'Asia/Kolkata',true),($2,'Audit Beta',$4,'Asia/Kolkata',true)`,
        [ids.school, ids.otherSchool, `audit-${ids.school}`, `audit-${ids.otherSchool}`]);
        for (const [key, role, school] of [
            ['admin', 'admin', ids.school], ['extraAdmin', 'student', ids.school],
            ['teacher', 'teacher', ids.school], ['subjectTeacher', 'student', ids.school],
            ['otherAdmin', 'admin', ids.otherSchool], ['student', 'student', ids.school],
            ['student2', 'student', ids.school], ['foreignStudent', 'student', ids.otherSchool],
            ['schoolless', 'admin', null], ['parent', 'student', ids.school],
        ]) {
            const email = `${ids[key]}@audit.invalid`;
            await db.query(`INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
                VALUES($1,$2,$3::jsonb,$3::jsonb)`, [ids[key], email, JSON.stringify({ role, school_id: school, full_name: key })]);
            await db.query(`INSERT INTO public.profiles(id,email,full_name,role,school_id,is_active)
                VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(id) DO UPDATE
                SET role=EXCLUDED.role,school_id=EXCLUDED.school_id,is_active=true,deleted_at=null`,
            [ids[key], email, key, role, school]);
        }
        await db.query(`INSERT INTO public.user_roles(user_id,role) VALUES($1,'admin'),($2,'teacher'),($3,'parent')
            ON CONFLICT DO NOTHING`, [ids.extraAdmin, ids.subjectTeacher, ids.parent]);
        await db.query(`INSERT INTO public.employees(profile_id,school_id,status) VALUES($1,$3,'active'),($2,$3,'active')
            ON CONFLICT(profile_id) DO UPDATE SET status='active',deleted_at=null`, [ids.teacher, ids.subjectTeacher, ids.school]);
        const dates = (await db.query(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS today,
            ((now() AT TIME ZONE 'Asia/Kolkata')::date+1)::text AS tomorrow,
            extract(dow FROM now() AT TIME ZONE 'Asia/Kolkata')::int AS weekday`)).rows[0];
        await db.query(`INSERT INTO public.academic_years(id,school_id,name,start_date,end_date)
            VALUES($1,$2,'Audit year',$3::date-30,$3::date+100)`, [ids.year, ids.school, dates.today]);
        await db.query(`INSERT INTO public.classes(id,school_id,name,academic_year_id,teacher_id)
            VALUES($1,$3,'Audit class',$4,$5),($2,$3,'Second class',$4,null)`,
        [ids.class, ids.otherClass, ids.school, ids.year, ids.teacher]);
        await db.query('INSERT INTO public.subjects(id,school_id,name) VALUES($1,$2,$3)', [ids.subject, ids.school, 'Audit subject']);
        await db.query(`INSERT INTO public.subject_teachers(school_id,class_id,subject_id,teacher_id,academic_year_id)
            VALUES($1,$2,$3,$4,$6),($1,$2,$3,$5,$6)`,
        [ids.school, ids.class, ids.subject, ids.teacher, ids.subjectTeacher, ids.year]);
        await actor(ids.admin);
        assert.equal((await db.query('SELECT public.fn_bulk_enroll_students($1,$2) AS n',
            [ids.class, [ids.student, ids.student2]])).rows[0].n, 2);
        await denied('SELECT public.fn_bulk_enroll_students($1,$2)', [ids.otherClass, [ids.parent, ids.foreignStudent]]);
        await denied('SELECT public.fn_bulk_enroll_students($1,$2)', [ids.otherClass, [ids.parent, ids.parent]]);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM public.class_enrollments WHERE class_id=$1', [ids.otherClass])).rows[0].n, 0);
        const marks = [{ student_id: ids.student, status: 'present', notes: 'Retain this note' },
            { student_id: ids.student2, status: 'absent' }];
        const save = 'SELECT public.fn_mark_class_attendance($1,$2,$3::jsonb) AS n';
        assert.equal((await db.query(save, [ids.class, dates.today, JSON.stringify(marks)])).rows[0].n, 2);
        const original = (await db.query('SELECT id FROM public.attendance WHERE student_id=$1', [ids.student])).rows[0].id;
        await actor(ids.extraAdmin);
        marks[0] = { student_id: ids.student, status: 'late' };
        assert.equal((await db.query(save, [ids.class, dates.today, JSON.stringify(marks)])).rows[0].n, 2);
        const corrected = (await db.query('SELECT id,status,notes FROM public.attendance WHERE student_id=$1', [ids.student])).rows[0];
        assert.equal(corrected.id, original);
        assert.equal(corrected.status, 'late');
        assert.equal(corrected.notes, 'Retain this note');
        assert.ok((await db.query("SELECT id FROM public.audit_logs WHERE record_id=$1 AND old_data->>'status'='present' AND new_data->>'status'='late'", [original])).rowCount);
        await denied(save, [ids.class, dates.tomorrow, JSON.stringify(marks)]);
        await denied(save, [ids.class, '1900-01-01', JSON.stringify(marks)]);
        await denied(save, [ids.class, dates.today, JSON.stringify(marks.slice(0, 1))]);
        await denied(save, [ids.class, dates.today, JSON.stringify([marks[0], marks[0]])]);
        await denied(save, [ids.class, dates.today, JSON.stringify([marks[0], { student_id: ids.foreignStudent, status: 'present' }])]);
        await actor(ids.schoolless);
        await denied('SELECT public.fn_class_overview($1)', [ids.class]);
        await denied(save, [ids.class, dates.today, JSON.stringify(marks)]);
        await actor(ids.otherAdmin);
        await denied(save, [ids.class, dates.today, JSON.stringify(marks)]);
        await actor(ids.teacher);
        await denied(save, [ids.class, dates.today, JSON.stringify(marks)]);
        await owner();
        await db.query(`INSERT INTO public.staff_unlock_sessions(user_id,school_id,session_token,auth_session_id,expires_at)
            VALUES($1,$3,$4,$5,now()+interval '1 hour'),($2,$3,$6,$5,now()+interval '1 hour')`,
        [ids.teacher, ids.subjectTeacher, ids.school, randomUUID(), ids.session, randomUUID()]);
        await actor(ids.subjectTeacher, ids.session);
        assert.equal((await db.query('SELECT public.fn_class_attendance_roster($1,$2) AS roster', [ids.class, dates.today])).rows[0].roster.students.length, 2);
        await denied(save, [ids.class, dates.today, JSON.stringify(marks)]);
        await actor(ids.teacher, ids.session);
        assert.equal((await db.query(save, [ids.class, dates.today, JSON.stringify(marks)])).rows[0].n, 2);
        await denied(save, [ids.otherClass, dates.today, '[]']);
        assert.equal((await db.query("UPDATE public.classes SET name='Forbidden' WHERE id=$1 RETURNING id", [ids.class])).rowCount, 0);
        const draft = { class_id: ids.class, kind: 'weekly', subject_id: ids.subject, teacher_id: ids.teacher,
            day_of_week: dates.weekday, start_time: '09:00', end_time: '10:00', start_date: dates.today, end_date: dates.today, room: 'Audit room' };
        await denied('SELECT public.timetable_save_draft($1::jsonb)', [JSON.stringify({ ...draft, teacher_id: ids.subjectTeacher })]);
        const draftId = (await db.query('SELECT public.timetable_save_draft($1::jsonb) AS id', [JSON.stringify(draft)])).rows[0].id;
        const preview = (await db.query('SELECT public.timetable_preview_draft($1) AS preview', [draftId])).rows[0].preview;
        assert.equal(preview.error, null);
        assert.equal(preview.before.length, 0);
        assert.equal(preview.after.length, 1);
        assert.equal((await db.query('SELECT * FROM public.timetable WHERE class_id=$1', [ids.class])).rowCount, 0);
        await actor(ids.student);
        assert.equal((await db.query('SELECT * FROM public.timetable_drafts WHERE id=$1', [draftId])).rowCount, 0);
        assert.equal((await db.query('SELECT * FROM public.timetable_schedule($1,$1,$2)', [dates.today, ids.class])).rowCount, 0);
        await actor(ids.teacher, ids.session);
        await db.query('SELECT public.timetable_publish_draft($1)', [draftId]);
        await actor(ids.student);
        assert.equal((await db.query('SELECT * FROM public.timetable_schedule($1,$1,$2)', [dates.today, ids.class])).rowCount, 1);
        await actor(ids.admin);
        const conflict = (await db.query('SELECT public.timetable_save_draft($1::jsonb) AS id', [JSON.stringify(draft)])).rows[0].id;
        assert.match((await db.query('SELECT public.timetable_preview_draft($1) AS p', [conflict])).rows[0].p.error, /conflict/i);
        await denied('SELECT public.timetable_publish_draft($1)', [conflict], /conflict/i);
        await owner();
        await db.query(`INSERT INTO public.subject_teachers(school_id,class_id,subject_id,teacher_id,academic_year_id)
            VALUES($1,$2,$3,$4,$5)`, [ids.school, ids.otherClass, ids.subject, ids.teacher, ids.year]);
        await actor(ids.admin);
        for (const [change, conflictType] of [
            [{ class_id: ids.otherClass, room: 'Different room' }, /Teacher conflict/i],
            [{ class_id: ids.otherClass, teacher_id: null }, /Room conflict/i],
        ]) {
            const candidate = (await db.query('SELECT public.timetable_save_draft($1::jsonb) AS id', [JSON.stringify({ ...draft, ...change })])).rows[0].id;
            assert.match((await db.query('SELECT public.timetable_preview_draft($1) AS p', [candidate])).rows[0].p.error, conflictType);
            await denied('SELECT public.timetable_publish_draft($1)', [candidate], conflictType);
        }
        const proposed = { ...draft, start_time: '11:00', end_time: '12:00' };
        const approvedId = (await db.query('SELECT public.timetable_save_draft($1::jsonb) AS id', [JSON.stringify(proposed)])).rows[0].id;
        const snapshot = (await db.query('SELECT to_jsonb(d) AS draft FROM public.timetable_drafts d WHERE id=$1', [approvedId])).rows[0].draft;
        await db.query('SELECT public.timetable_save_draft($1::jsonb)', [JSON.stringify({ ...proposed, id: approvedId, room: 'Changed after approval' })]);
        await denied('SELECT public.timetable_publish_approved($1,$2::jsonb)', [approvedId, JSON.stringify(snapshot)], /Draft changed/i);
        const exceptionId = (await db.query('SELECT public.timetable_save_draft($1::jsonb) AS id',
            [JSON.stringify({ ...proposed, kind: 'exception', start_time: '13:00', end_time: '14:00' })])).rows[0].id;
        const publishedException = (await db.query('SELECT public.timetable_publish_draft($1) AS id', [exceptionId])).rows[0].id;
        await owner();
        await db.query("UPDATE public.employees SET status='inactive' WHERE profile_id=$1", [ids.teacher]);
        assert.equal((await db.query('SELECT teacher_id FROM public.timetable_exceptions WHERE id=$1', [publishedException])).rows[0].teacher_id, null);
        await owner();
        await db.query(`INSERT INTO public.parent_student(parent_id,student_id,school_id,status)
            VALUES($1,$2,$3,'active')`, [ids.parent, ids.student, ids.school]);
        await actor(ids.parent);
        assert.equal((await db.query('SELECT public.fn_can_access_student($1) AS allowed', [ids.student])).rows[0].allowed, true);
        assert.equal((await db.query('SELECT public.fn_can_access_student($1) AS allowed', [ids.foreignStudent])).rows[0].allowed, false);
        assert.ok((await db.query('SELECT * FROM public.timetable_schedule($1,$1,$2)', [dates.today, ids.class])).rowCount > 0);
        await denied('SELECT * FROM public.mcp_child_announcements($1)', [ids.foreignStudent]);
        await actor(ids.foreignStudent);
        assert.equal((await db.query('SELECT * FROM public.timetable_schedule($1,$1,$2)', [dates.today, ids.class])).rowCount, 0);
        await owner();
        await db.query(`INSERT INTO public.mcp_clients(id,name,redirect_uris) VALUES($1,'Audit client','["https://audit.invalid/callback"]')`, [ids.client]);
        await db.query('INSERT INTO public.mcp_grants(id,user_id,client_id,school_id,token_version) VALUES($1,$2,$3,$4,$5)',
            [ids.grant, ids.admin, ids.client, ids.school, ids.version]);
        const proposal = async () => {
            await owner();
            return (await db.query(`INSERT INTO public.mcp_action_requests(grant_id,grant_version,actor_id,client_id,school_id,action,payload,payload_hash)
                VALUES($1,$2,$3,$4,$5,'admin_enroll_students','{}','test-only') RETURNING id`,
            [ids.grant, ids.version, ids.admin, ids.client, ids.school])).rows[0].id;
        };
        let requestId = await proposal();
        await actor(ids.admin);
        await db.query('SELECT public.mcp_claim_action($1,true)', [requestId]);
        await denied('SELECT public.mcp_claim_action($1,true)', [requestId]);
        requestId = await proposal();
        await db.query("UPDATE public.mcp_action_requests SET expires_at=now()-interval '1 second' WHERE id=$1", [requestId]);
        await actor(ids.admin);
        await denied('SELECT public.mcp_claim_action($1,true)', [requestId]);
        requestId = await proposal();
        await db.query('UPDATE public.mcp_grants SET token_version=$2 WHERE id=$1', [ids.grant, randomUUID()]);
        await actor(ids.admin);
        await denied('SELECT public.mcp_claim_action($1,true)', [requestId]);
        await owner();
        await db.query('UPDATE public.mcp_grants SET token_version=$2 WHERE id=$1', [ids.grant, ids.version]);
        requestId = await proposal();
        await db.query('UPDATE public.mcp_grants SET revoked_at=now() WHERE id=$1', [ids.grant]);
        await actor(ids.admin);
        await denied('SELECT public.mcp_claim_action($1,true)', [requestId]);
        await owner();
        await db.query('UPDATE public.mcp_grants SET revoked_at=null WHERE id=$1', [ids.grant]);
        await db.query('UPDATE public.schools SET ai_connections_enabled=false WHERE id=$1', [ids.school]);
        await actor(ids.admin);
        await denied('SELECT public.mcp_claim_action($1,true)', [requestId]);
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});
