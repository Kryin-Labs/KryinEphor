import { auth, defineMcp, type ToolHandlerResult } from '@lovable.dev/mcp-js';
import { service, verifyGrant, verifyMcpToken } from './auth-server.js';
import { adminOverviewTool, adminWhoamiTool, attendanceReportTool, classAttendanceTool, classStudentsTool, feeSummaryTool, findUsersTool, listClassesTool, markAttendanceTool } from './admin-tools.js';
import { updateClassTool, updateUserNameTool } from './admin-write-tools.js';
import { requestAnnouncementTool, requestCreateUserTool, requestEnrollmentTool, requestFeePaymentTool, requestPasswordResetTool, requestUserActiveTool, requestUserRolesTool, teacherRequestAttendanceTool } from './approval-tools.js';
import { adminSaveTimetableDraftTool, adminTimetableTool, previewTimetableTool, requestPublishTimetableTool, teacherPreviewTimetableTool, teacherRequestDraftTool, teacherRequestPublishTimetableTool } from './timetable-tools.js';
import { mcpPublicUrl } from './support.js';
import { studentAnnouncementsTool, studentDashboardTool, studentFeesTool, studentHomeworkTool, studentProfileTool, studentScheduleTool } from './student-tools.js';
import { teacherClassesTool, teacherClassStudentsTool, teacherScheduleTool } from './teacher-tools.js';
import { superadminFindSchoolsTool, superadminFindUsersTool, superadminRequestUserStatusTool, superadminTimetableTool } from './superadmin-tools.js';

export const adminTools = [adminWhoamiTool, adminOverviewTool, findUsersTool, listClassesTool,
    classStudentsTool, classAttendanceTool, attendanceReportTool, feeSummaryTool,
    markAttendanceTool, updateUserNameTool, adminTimetableTool, adminSaveTimetableDraftTool,
    previewTimetableTool, requestPublishTimetableTool, requestUserActiveTool,
    requestEnrollmentTool, requestFeePaymentTool, requestAnnouncementTool,
    requestCreateUserTool, requestPasswordResetTool, requestUserRolesTool, updateClassTool];
export const teacherTools = [teacherClassesTool, teacherClassStudentsTool, teacherScheduleTool,
    teacherPreviewTimetableTool, teacherRequestDraftTool, teacherRequestPublishTimetableTool,
    teacherRequestAttendanceTool];
export const studentTools = [studentDashboardTool, studentProfileTool, studentScheduleTool,
    studentHomeworkTool, studentFeesTool, studentAnnouncementsTool];
export const superadminTools = [superadminFindSchoolsTool, superadminFindUsersTool,
    superadminTimetableTool, superadminRequestUserStatusTool];

export const makeMcp = (tools: Parameters<typeof defineMcp>[0]['tools']) => defineMcp({
    name: 'kryin-edu',
    title: 'Kryin Edu',
    version: '1.0.0',
    instructions: 'Kryin Edu contains private school data. Use only the connected account’s authorized tools. Student and parent data is read-only. Sensitive changes require approval in KryinEphor.',
    metrics: false,
    auth: auth.oauth.issuer({
        issuer: mcpPublicUrl,
        acceptedAudiences: `${mcpPublicUrl}/api/mcp`,
        jwksUri: `${mcpPublicUrl}/api/oauth/jwks`,
        resource: `${mcpPublicUrl}/api/mcp`,
        requireOAuthClientClaim: true,
    }),
    tools: tools.map(definition => ({ ...definition, handler: async (input, ctx) => {
        const claims = verifyMcpToken(ctx.getToken() ?? '');
        const db = service(claims.sub);
        const { data: grant } = await db.from('mcp_grants').select('school_id')
            .eq('id', claims.grant_id).eq('user_id', claims.sub).eq('client_id', claims.client_id).single();
        const requestedSchool = input && typeof input === 'object' && 'school_id' in input
            && typeof input.school_id === 'string' && /^[0-9a-f-]{36}$/i.test(input.school_id) ? input.school_id : null;
        const schoolId = grant?.school_id ?? requestedSchool;
        const { data: log, error: logError } = await db.from('mcp_call_logs').insert({
            actor_id: claims.sub, client_id: claims.client_id, grant_id: claims.grant_id,
            school_id: schoolId, tool_name: definition.name, outcome: 'running',
        }).select('id').single();
        if (logError || !log) throw new Error('AI audit history is unavailable; retry later.');
        let outcome = 'denied';
        let result: ToolHandlerResult;
        try {
            await verifyGrant(claims);
            outcome = 'failed';
            result = await definition.handler(input, ctx);
            if (!result.isError) outcome = 'succeeded';
        } catch (error) {
            result = { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Request failed.' }] };
        }
        const errorText = result.isError ? (result.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n') : null;
        const { error: updateError } = await db.from('mcp_call_logs').update({ outcome, error_text: errorText }).eq('id', log.id);
        if (updateError) throw new Error('Request ran but its audit status could not be saved. Check AI Connections before retrying a write.');
        if (definition.annotations?.readOnlyHint === false && !result.structuredContent?.approval_id) {
            const { error: noticeError } = await db.from('notifications').insert({
                school_id: schoolId, user_id: claims.sub, title: `AI action ${outcome}`,
                message: errorText ?? `${definition.title} completed.`,
                type: result.isError ? 'error' : 'success', action_url: '/ai-connections',
                metadata: { call_id: log.id },
            });
            if (noticeError) throw new Error('Request ran but its status notice could not be saved. Check AI Connections before retrying.');
        }
        return result;
    } })),
});

const mcp = makeMcp([]);

export default mcp;
