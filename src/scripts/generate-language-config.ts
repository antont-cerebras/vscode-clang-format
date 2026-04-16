import * as fs from "fs";
import * as path from "path";
import {
  SupportedLanguage,
  SUPPORTED_LANGUAGES,
  ALIAS,
  STYLE_OVERRIDES,
  DISPLAY_NAMES,
  StyleOverride,
} from "../shared/languageConfig";

interface PackageJson {
  activationEvents: string[];
  contributes: {
    configuration: {
      properties: Record<string, unknown>;
    };
  };
}

function generateLanguageConfig(
  lang: SupportedLanguage,
): Record<string, unknown> {
  const baseKey = `clang-format.language.${ALIAS[lang] ?? lang}`;
  const displayName = DISPLAY_NAMES[lang];
  const override: StyleOverride = STYLE_OVERRIDES[lang] ?? {};

  return {
    [`${baseKey}.enable`]: {
      type: "boolean",
      default: true,
      description:
        override.description ??
        `enable formatting for ${displayName} (requires reloading Extensions)`,
    },
    [`${baseKey}.style`]: {
      type: "string",
      default: "",
      description: `clang-format style for ${displayName}, leave empty to use global clang-format.style`,
      scope: "resource",
    },
    [`${baseKey}.fallbackStyle`]: {
      type: "string",
      default: override.fallbackStyle ?? "",
      description: `clang-format fallback style for ${displayName}, leave empty to use clang-format.fallbackStyle`,
      scope: "resource",
    },
  };
}

function generateActivationEvents(): string[] {
  return [
    ...SUPPORTED_LANGUAGES.map((lang) => `onLanguage:${lang}`),
    "onStartupFinished",
  ];
}

function main() {
  // Read the existing package.json
  const packageJsonPath = path.join(__dirname, "..", "..", "package.json");
  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8"),
  ) as PackageJson;

  // Generate language configurations
  const languageConfigs = SUPPORTED_LANGUAGES.reduce<Record<string, unknown>>(
    (acc, lang) => {
      return { ...acc, ...generateLanguageConfig(lang) };
    },
    {},
  );

  // Generate activation events
  packageJson.activationEvents = generateActivationEvents();

  // Split existing properties into non-language (preserved as-is) and language
  // (regenerated from shared/languageConfig.ts). This way new non-language
  // settings never need to be registered here.
  const existing = packageJson.contributes.configuration.properties;
  const beforeLang: Record<string, unknown> = {};
  const afterLang: Record<string, unknown> = {};
  let seenLanguageKey = false;
  for (const [key, value] of Object.entries(existing)) {
    if (key.startsWith("clang-format.language.")) {
      seenLanguageKey = true;
    } else if (seenLanguageKey) {
      afterLang[key] = value;
    } else {
      beforeLang[key] = value;
    }
  }

  packageJson.contributes.configuration.properties = {
    ...beforeLang,
    ...languageConfigs,
    ...afterLang,
  };

  // Write back to package.json with consistent formatting
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + "\n",
  );
}

main();
