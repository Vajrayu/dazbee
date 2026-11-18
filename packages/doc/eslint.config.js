import preset, { adr0001Pattern } from '@dazbee/config/eslint'

export default [
  ...preset,
  {
    // A command's `apply` writes as it goes, and a throw halfway is a fault, so nothing it runs may throw
    // on a value: no function of a command file calls a throwing parser. `check` refuses with
    // `safeParse`, and the input's own schema hands `apply` the validated value.
    files: ['src/commands/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: ":function CallExpression[callee.property.name='parse']",
          message: 'A command never runs a throwing parser: validate with safeParse in check, or in the input schema.',
        },
      ],
    },
  },
  {
    // Commands see only the store (store.ts), never what keeps it, so every store runs them the same.
    files: ['src/commands/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            adr0001Pattern,
            {
              regex: '(^|/)(client-store|plain-store)(\\.ts)?$',
              message: 'A command reads and writes through the store (store.ts), never what keeps it.',
            },
          ],
        },
      ],
    },
  },
]
