import {
    defineConfig,
    eslintConfig,
    globals,
    TYPESCRIPT_SCRIPTS_SCOPE,
} from 'arui-presets-lint/eslint';

// Existing protocol parsers and screen components remain cohesive during the style migration.
// These explicit ceilings keep their current size/branching visible without weakening new modules.
const existingLineLimits = {
    'src/main/calendarService.ts': 1000,
    'src/main/demo.ts': 500,
    'src/main/index.ts': 1652,
    'src/main/owa/availability.ts': 500,
    'src/main/owa/client.ts': 900,
    'src/main/owa/ewsMeeting.ts': 500,
    'src/main/owa/http.ts': 400,
    'src/main/owa/parse.ts': 600,
    'src/main/trayRaster.ts': 500,
    'src/renderer/Availability.tsx': 700,
    'src/renderer/Calendar.tsx': 400,
    'src/renderer/Create.tsx': 700,
    'src/renderer/Detail.tsx': 500,
    'src/renderer/PeopleField.tsx': 400,
    'src/renderer/Popup.tsx': 600,
    'src/renderer/Settings.tsx': 700,
    'src/renderer/Stats.tsx': 500,
    'src/shared/availability.ts': 500,
    'src/shared/i18n.ts': 1000,
    'src/shared/meetingConfirm.ts': 400,
    'src/shared/stats.ts': 400,
    'src/shared/types.ts': 500,
    'src/shared/validate.ts': 600,
    'test/accountRequests.test.ts': 400,
    'test/availability.test.ts': 1500,
    'test/create.test.ts': 1600,
    'test/editMeeting.test.ts': 500,
    'test/ews.test.ts': 500,
    'test/security.test.ts': 600,
    'test/stats.test.ts': 600,
};

const existingComplexity = {
    'src/main/calendarService.ts': 35,
    'src/main/owa/availability.ts': 50,
    'src/main/owa/client.ts': 25,
    'src/main/owa/ewsMeeting.ts': 25,
    'src/main/trayRaster.ts': 30,
    'src/renderer/Availability.tsx': 25,
    'src/renderer/Create.tsx': 35,
    'src/renderer/Detail.tsx': 35,
    'src/renderer/PeopleField.tsx': 25,
    'src/renderer/Popup.tsx': 35,
    'src/renderer/ReplyPanel.tsx': 30,
    'src/renderer/Settings.tsx': 35,
    'src/shared/availability.ts': 40,
    'src/shared/meetingConfirm.ts': 25,
    'src/shared/meetingUrl.ts': 25,
    'src/shared/stats.ts': 30,
    'src/shared/validate.ts': 25,
};

export default defineConfig(eslintConfig, [
    ...Object.entries(existingLineLimits).map(([file, max]) => ({
        files: [file],
        rules: { 'max-lines': ['warn', max] },
    })),
    ...Object.entries(existingComplexity).map(([file, max]) => ({
        files: [file],
        rules: { complexity: ['warn', max] },
    })),
    {
        files: ['src/main/trayRaster.ts'],
        // Signed distance functions take explicit geometry and color coordinates.
        rules: { '@typescript-eslint/max-params': ['warn', { max: 7 }] },
    },
    {
        files: ['src/main/meetingGate.ts'],
        // The sliding window implementation is private to the consent gate.
        rules: { 'max-classes-per-file': ['error', 2] },
    },
    {
        files: ['**/*.{ts,tsx,mjs}'],
        rules: {
            // A void statement explicitly marks fire-and-forget work; type-aware promise checks remain enabled.
            'no-void': ['error', { allowAsStatement: true }],
            'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],
        },
    },
    {
        files: ['src/renderer/**/*.{ts,tsx}'],
        rules: {
            // JSX presentation commonly selects both a state and its localized label.
            'no-nested-ternary': 'off',
        },
    },
    {
        files: ['scripts/*.mjs'],
        rules: { 'no-console': 'off' }, // CLI commands communicate their result on stdout/stderr.
    },
    {
        files: ['.github/ISSUE_TEMPLATE/*.yml'],
        rules: {
            // GitHub uses the conventional bug_report.yml template filename.
            'check-file/filename-naming-convention': ['error', { '**/*.yml': 'SNAKE_CASE' }],
        },
    },
    {
        files: ['src/shared/{i18n,meetingConfirm,replyText,toasts}.ts'],
        rules: {
            // Paired translations keep both languages adjacent inside conditional labels.
            'no-nested-ternary': 'off',
        },
    },
    {
        files: [TYPESCRIPT_SCRIPTS_SCOPE],
        languageOptions: {
            parserOptions: {
                // Renderer and Electron have separate TypeScript projects.
                projectService: false,
                project: ['./tsconfig.json', './tsconfig.node.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        files: ['src/**/*.{ts,tsx}', 'scripts/*.mjs', 'test/*.ts'],
        rules: {
            // Dependencies are bundled by esbuild/Vite; the packaged app has no node_modules.
            'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],
        },
    },
    {
        files: [
            'src/main/**/*.ts',
            'src/mcp/**/*.ts',
            'src/preload/**/*.ts',
            'scripts/*.mjs',
            'test/*.ts',
            '*.mjs',
        ],
        languageOptions: { globals: globals.node },
    },
    {
        files: ['src/**/*.ts', 'src/**/*.tsx', 'test/*.ts'],
        rules: {
            // Keep the established camelCase modules and PascalCase React components.
            'check-file/filename-naming-convention': [
                'error',
                { '**/*.{ts,tsx}': '+([a-zA-Z0-9-])' },
                { ignoreMiddleExtensions: true },
            ],
        },
    },
]);
