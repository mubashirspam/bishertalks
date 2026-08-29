import coreWebVitals from "eslint-config-next/core-web-vitals";

/**
 * Flat config.
 *
 * This project had a `lint` script calling `next lint`, which Next 16 removed,
 * and a `.eslintrc.json` that ESLint 9 no longer reads — so nothing had been
 * linted for a while. eslint-config-next 16 ships flat config directly, so no
 * compatibility wrapper is needed.
 */
const config = [
  ...coreWebVitals,

  {
    ignores: [".next/**", "node_modules/**", "public/**", "next-env.d.ts"],
  },

  {
    rules: {
      /**
       * The send gate is not optional.
       *
       * `sendTemplate` and `sendText` are the raw Cloud API calls. They skip
       * every check in assertSendable() — the stop flag first among them — so
       * a caller reaching for them directly can message somebody who
       * explicitly asked never to be contacted again.
       *
       * A convention would not survive the next person in a hurry. This makes
       * it a build error instead.
       */
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/whatsapp",
              importNames: ["sendTemplate", "sendText", "sendInteractive"],
              message:
                "Send through lib/crm/send.ts instead. sendTemplate, sendText and sendInteractive skip the consent, kill-switch, number-health, template-approval, frequency and budget checks in assertSendable() — including the stop flag. If you need something the gate does not allow, change the gate.",
            },
          ],
        },
      ],
    },
  },

  {
    // The gate itself has to make the raw call. One file, one exemption.
    files: ["lib/crm/send.ts"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
