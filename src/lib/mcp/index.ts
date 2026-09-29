import { auth, defineMcp } from '@lovable.dev/mcp-js';
import { adminOverviewTool, adminWhoamiTool, attendanceReportTool, classAttendanceTool, classStudentsTool, feeSummaryTool, findUsersTool, listClassesTool, markAttendanceTool } from './admin-tools.js';
import { createAnnouncementTool, createUserTool, enrollStudentsTool, recordFeePaymentTool, resetUserPasswordTool, setUserActiveTool, setUserRolesTool, updateUserNameTool, verifyRecoveryEmailTool } from './admin-write-tools.js';
import { mcpPublicUrl, serverEnv } from './support.js';
import { studentAnnouncementsTool, studentDashboardTool, studentFeesTool, studentHomeworkTool, studentProfileTool, studentScheduleTool } from './student-tools.js';
import { teacherClassesTool, teacherClassStudentsTool, teacherMarkAttendanceTool, teacherScheduleTool } from './teacher-tools.js';

const projectUrl = serverEnv.VITE_SUPABASE_URL;
if (!projectUrl) throw new Error('VITE_SUPABASE_URL is required for Kryin Edu MCP.');

const mcp = defineMcp({
    name: 'kryin-edu',
    title: 'Kryin Edu',
    version: '1.0.0',
    instructions: 'Kryin Edu contains private school data. Use only the connected account’s authorized tools. Student and parent data is read-only. Ask for confirmation before every admin write tool.',
    metrics: false,
    auth: auth.oauth.issuer({
        issuer: `${projectUrl}/auth/v1`,
        acceptedAudiences: 'authenticated',
        jwksUri: `${projectUrl}/auth/v1/.well-known/jwks.json`,
        resource: `${mcpPublicUrl}/api/mcp`,
    }),
    tools: [
        // Admin — read
        adminWhoamiTool, adminOverviewTool, findUsersTool, listClassesTool, classStudentsTool, classAttendanceTool, attendanceReportTool, feeSummaryTool,
        // Admin — write
        markAttendanceTool, updateUserNameTool, createUserTool, verifyRecoveryEmailTool, setUserRolesTool, setUserActiveTool, resetUserPasswordTool, enrollStudentsTool, recordFeePaymentTool, createAnnouncementTool,
        // Teacher
        teacherClassesTool, teacherClassStudentsTool, teacherScheduleTool, teacherMarkAttendanceTool,
        // Student/parent — own data only
        studentDashboardTool, studentProfileTool, studentScheduleTool, studentHomeworkTool, studentFeesTool, studentAnnouncementsTool,
    ],
});

export default mcp;
