import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

test('Real PostgreSQL Integration: Secondary Admin Capability in fn_setup_tenant_user_domain', async (t) => {
    if (!dbUrl) {
        t.skip('DATABASE_URL / SUPABASE_DB_URL not configured. Skipping live PostgreSQL transaction test (safe offline default).');
        return;
    }

    const client = new pg.Client({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false },
    });

    await client.connect();

    try {
        await client.query('BEGIN');

        const schoolA = '11111111-1111-4111-8111-111111111111';
        const schoolB = '22222222-2222-4222-8222-222222222222';
        const teacherAdminId = '33333333-3333-4333-8333-333333333333';
        const plainTeacherId = '44444444-4444-4444-8444-444444444444';
        const targetUserId = '55555555-5555-4555-8555-555555555555';

        // 1. Seed test schools
        await client.query(`
            INSERT INTO schools (id, name, slug) 
            VALUES 
                ($1, 'Alpha Test School', 'alpha-test-integration'),
                ($2, 'Beta Test School', 'beta-test-integration')
            ON CONFLICT (id) DO NOTHING;
        `, [schoolA, schoolB]);

        // 2. Seed auth.users & profiles via trigger
        await client.query(`
            INSERT INTO auth.users (id, email, raw_app_meta_data)
            VALUES 
                ($1, 'teacher_admin@integ.test', jsonb_build_object('role', 'teacher', 'school_id', $4::uuid)),
                ($2, 'plain_teacher@integ.test', jsonb_build_object('role', 'teacher', 'school_id', $4::uuid)),
                ($3, 'target_user@integ.test', jsonb_build_object('role', 'teacher', 'school_id', $4::uuid))
            ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data;
        `, [teacherAdminId, plainTeacherId, targetUserId, schoolA]);

        await client.query(`
            UPDATE profiles SET school_id = $1, role = 'teacher', is_active = true WHERE id = $2;
            UPDATE profiles SET school_id = $1, role = 'teacher', is_active = true WHERE id = $3;
            UPDATE profiles SET school_id = $1, role = 'teacher', is_active = true WHERE id = $4;
        `, [schoolA, teacherAdminId, plainTeacherId, targetUserId]);

        // 3. Assign secondary 'admin' capability to teacherAdmin in user_roles
        await client.query(`
            INSERT INTO user_roles (user_id, role) 
            VALUES ($1, 'admin') 
            ON CONFLICT (user_id, role) DO NOTHING;
        `, [teacherAdminId]);

        // Scenario A: Teacher with secondary Admin capability -> setup user in SAME school -> ALLOWED
        const allowedRes = await client.query(`
            SELECT public.fn_setup_tenant_user_domain(
                _user_id => $1::uuid,
                _email => 'target_user@integ.test',
                _full_name => 'Target Student User',
                _role => 'teacher',
                _school_id => $2::uuid,
                _caller_id => $3::uuid
            ) AS result;
        `, [targetUserId, schoolA, teacherAdminId]);

        assert.equal(allowedRes.rows[0].result.success, true, 'Same-school setup by secondary admin must succeed');

        // Scenario B: Teacher with secondary Admin capability -> setup user in CROSS school -> DENIED
        await assert.rejects(
            async () => {
                await client.query(`
                    SELECT public.fn_setup_tenant_user_domain(
                        _user_id => $1::uuid,
                        _email => 'target_user@integ.test',
                        _full_name => 'Target Student User',
                        _role => 'teacher',
                        _school_id => $2::uuid,
                        _caller_id => $3::uuid
                    );
                `, [targetUserId, schoolB, teacherAdminId]);
            },
            (err) => {
                assert.match(err.message, /school admin may only configure users for their own school/i);
                return true;
            },
            'Cross-school setup by secondary admin must be denied'
        );

        // Scenario C: Plain teacher without admin role -> setup user in same school -> DENIED
        await assert.rejects(
            async () => {
                await client.query(`
                    SELECT public.fn_setup_tenant_user_domain(
                        _user_id => $1::uuid,
                        _email => 'target_user@integ.test',
                        _full_name => 'Target Student User',
                        _role => 'teacher',
                        _school_id => $2::uuid,
                        _caller_id => $3::uuid
                    );
                `, [targetUserId, schoolA, plainTeacherId]);
            },
            (err) => {
                assert.match(err.message, /Access denied: insufficient privileges/i);
                return true;
            },
            'Setup by plain teacher without admin role must be denied'
        );

    } finally {
        // Rollback all changes unconditionally to keep DB pristine
        await client.query('ROLLBACK');
        await client.end();
    }
});
