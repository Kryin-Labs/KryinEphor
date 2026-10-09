import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Render the real components in Node with controlled network/query states. No browser or DOM shim.
const generated = resolve('tests', `.frontend-states-${randomUUID()}.mjs`);
const output = await build({
    stdin: { contents: `
        export { default as Attendance } from '../src/components/classes/tabs/AttendanceTab.tsx';
        export { default as AttendancePage } from '../src/pages/AttendancePage.tsx';
        export { default as Connections } from '../src/pages/AIConnections.tsx';
        export { default as Consent } from '../src/pages/OAuthConsent.tsx';
    `, resolveDir: resolve('tests'), loader: 'tsx' },
    bundle: true, jsx: 'automatic', platform: 'node', format: 'esm', packages: 'external', write: false, logLevel: 'silent',
    plugins: [{ name: 'controlled-query-state', setup(build) {
        build.onResolve({ filter: /@tanstack\/react-query$|context\/AuthContext$|lib\/supabase$|dashboard\/(Sidebar|Header)$|react-router-dom$/ }, args => ({ path: args.path, namespace: 'test-state' }));
        build.onLoad({ filter: /.*/, namespace: 'test-state' }, args => {
            if (args.path.endsWith('react-query')) return { contents: `
                export const useQuery = options => {
                    globalThis.__frontend.queries.push(options);
                    return { ...globalThis.__frontend.snapshot(options.queryKey), refetch: async () => ({}) };
                };
                export const useMutation = options => {
                    globalThis.__frontend.mutation = options;
                    return { isPending: globalThis.__frontend.saving, mutate: () => {} };
                };
                export const useQueryClient = () => ({ invalidateQueries: async () => {} });
            ` };
            if (args.path.endsWith('AuthContext')) return { contents: 'export const useAuth = () => globalThis.__frontend.auth;' };
            if (args.path.endsWith('supabase')) return { contents: 'export const supabase = {};' };
            if (args.path === 'react-router-dom') return { contents: `export const useNavigate = () => () => {};
                export const useSearchParams = () => [new URLSearchParams('request_id=current-request')];` };
            return { contents: 'export default function LayoutChrome() { return null; }' };
        });
    } }],
});
await writeFile(generated, output.outputFiles[0].text);
after(async () => { await unlink(generated); delete globalThis.__frontend; });
const { Attendance, AttendancePage, Connections, Consent } = await import(pathToFileURL(generated).href);
const ready = data => ({ data, isSuccess: true, isPending: false, isLoading: false, isFetching: false, error: null });
const pending = { data: undefined, isSuccess: false, isPending: true, isLoading: true, isFetching: true, error: null };
const failed = { ...pending, isPending: false, isLoading: false, isFetching: false, error: new Error('Read failed') };
function render(component, snapshot, saving = false, props = {}) {
    globalThis.__frontend = { queries: [], snapshot, saving,
        auth: { user: { id: 'admin', schoolId: 'school' }, roles: ['admin'], loading: false, isStaffUnlocked: true } };
    return renderToStaticMarkup(createElement(component, props));
}
const button = (html, label) => html.match(new RegExp(`<button\\b[^>]*>${label}</button>`))?.[0];

test('attendance cannot be edited or moved to another date during a save', () => {
    const html = render(Attendance, key => key[0] === 'attendance-school-zone' ? ready('Asia/Kolkata')
        : ready({ students: [{ student_id: 'student', full_name: 'Student' }], existing: [{ student_id: 'student', status: 'present', notes: null }] }),
    true, { classId: 'class', schoolId: 'school', canEdit: true });
    assert.match(html.match(/<input[^>]*type="date"[^>]*>/)?.[0] ?? '', /\sdisabled(?:=|[ >])/);
    assert.match(button(html, 'Mark all present') ?? '', /\sdisabled(?:=|[ >])/);
    const marks = html.match(/<button[^>]*aria-pressed[^>]*>/g) ?? [];
    assert.equal(marks.length, 5);
    assert.ok(marks.every(mark => /\sdisabled(?:=|[ >])/.test(mark)));
});

test('attendance loading and timezone failures do not appear as an empty roster or zero totals', () => {
    for (const school of [pending, failed]) {
        const html = render(AttendancePage, key => key[0] === 'attendance-school-zone' ? school
            : { ...pending, isLoading: false, isFetching: false });
        assert.doesNotMatch(html, /No classes are available|>Students<|>Present</);
    }
});

test('AI connections blocks school toggles and empty claims until data loads', () => {
    for (const snapshot of [pending, failed]) {
        const html = render(Connections, () => snapshot);
        assert.doesNotMatch(html, /No active connections|No AI actions yet|No tool calls yet/);
        assert.doesNotMatch(html, /Disabled for this school/);
        const toggle = button(html, 'Enable AI access');
        assert.ok(!toggle || /\sdisabled(?:=|[ >])/.test(toggle), 'school toggle requires a successful read');
        assert.match(html, snapshot.error ? /Read failed/ : /Loading/);
    }
});

test('OAuth consent details are scoped to the current account and authorization request', () => {
    render(Consent, () => pending);
    assert.ok(globalThis.__frontend.queries.some(({ queryKey }) =>
        queryKey.includes('admin') && queryKey.includes('current-request')));
});
