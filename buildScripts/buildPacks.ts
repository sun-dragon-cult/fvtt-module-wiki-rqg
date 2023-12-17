import chalk from "chalk";
import { existsSync, promises } from "fs";
import * as path from "path";
import * as fs from "fs";
import { cwd } from "process";
import { CompendiumPack, PackMetadata } from "./compendium-pack";
import { doTranslation, tryOrThrow } from "./utils";
import { PackError } from "./packError";

export const config = {
  assetDirs: ["tokens", "artwork"], // folder names to copy to dist as is
  i18nDir: path.resolve(cwd(), "module", "i18n"),
  translationsFileNames: ["uiContent", "rqgCompendiumContent"], // filenames except .json Will be part of the translation key
  distDir: path.resolve(cwd(), "dist"),
  packTemplateDir: path.resolve(cwd(), "pack-templates"),
  packageManifest: path.resolve(cwd(), "module", "module.json"),
} as const;

export const getOutDir = (language: string): string => path.join(config.distDir, language);

export const getPackOutDir = (language: string): string =>
  path.join(config.distDir, language, "packs");

const moduleManifest = JSON.parse(fs.readFileSync(config.packageManifest, "utf-8"));
export const packsMetadata = moduleManifest.packs as PackMetadata[];

const targetLanguages = fs.readdirSync(config.i18nDir).filter((file) => {
  return fs.statSync(path.join(config.i18nDir, file)).isDirectory();
});

for (const lang of targetLanguages) {
  const langOutDir = getPackOutDir(lang);
  if (!existsSync(langOutDir)) {
    await promises.mkdir(langOutDir, { recursive: true });
  }
  const localisedModuleManifest = doTranslation(lang, [moduleManifest])[0];

  tryOrThrow(
    () => {
      config.assetDirs.forEach((dir) => {
        const source = path.resolve(cwd(), "module", dir);
        const destination = path.resolve(getOutDir(lang), dir);
        fs.cpSync(source, destination, { recursive: true });
      });
    },
    (e: any) => {
      throw new PackError(`Error when copying assets dir:\n${e}`);
    },
  );

  const moduleFile = path.join(getOutDir(lang), "module.json");
  tryOrThrow(
    () => fs.writeFileSync(moduleFile, JSON.stringify(localisedModuleManifest, null, 2)),
    (e: any) => {
      throw new PackError(`Error when writing module.json:\n${e}`);
    },
  );
}

const templatePackDirPaths = fs
  .readdirSync(config.packTemplateDir)
  .filter((dirname) => !dirname.startsWith("_")) // Ignore folders that start with '_' like '_partial-includes'
  .map((dirName) => path.resolve(config.packTemplateDir, dirName));

// Loads all template packs into memory
const templatePacks = templatePackDirPaths.map((dirPath) => CompendiumPack.loadYAML(dirPath));

const translatedPacks: CompendiumPack[] = [];
templatePacks.forEach((pack) => {
  targetLanguages.forEach((lang) => {
    tryOrThrow(
      () => translatedPacks.push(pack.translate(lang)),
      (e: any) => {
        throw new PackError(`Error translating pack ${pack.name} to ${lang}: \n\n${e}`);
      },
    );
  });
});

let total = 0;
for (const pack of translatedPacks) {
  total += await pack.save();
}

if (translatedPacks.length === 0) {
  throw new PackError("No data available to build packs.");
}

const languageCount = targetLanguages.length;
console.log(
  chalk.green(
    `Created ${chalk.bold(translatedPacks.length)} packs with ${chalk.bold(
      total / languageCount,
    )} documents per language in ${chalk.bold(languageCount)} language modules.`,
  ),
);
