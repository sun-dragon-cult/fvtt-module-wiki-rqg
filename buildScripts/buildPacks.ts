import chalk from "chalk";
import { existsSync, promises } from "fs";
import * as path from "path";
import * as fs from "fs";
import {
  CompendiumPack,
  getDictionary,
  getLocalisedData,
  PackError,
  PackMetadata,
} from "./compendium-pack";

export const config = {
  i18nDir: "module/i18n", // TODO add path.resolve to all paths??? ***
  translationsFileNames: ["uiContent", "rqgCompendiumContent"],
  outDir: path.resolve(process.cwd(), "dist/{lang}/packs"),
  packTemplateDir: path.resolve(process.cwd(), "./pack-templates"),
  packageManifest: "./module/module.json",
} as const;

const moduleManifest = JSON.parse(fs.readFileSync(path.resolve(config.packageManifest), "utf-8"));
export const packsMetadata = moduleManifest.packs as PackMetadata[];

const targetLanguages = fs.readdirSync(config.i18nDir).filter((file) => {
  return fs.statSync(path.join(config.i18nDir, file)).isDirectory();
});

//check if the output directories exists, and create them if necessary
for (const lang of targetLanguages) {
  const langOutDir = config.outDir.replace("{lang}", lang);
  if (!existsSync(langOutDir)) {
    await promises.mkdir(langOutDir, { recursive: true });
  }
  const dictionary = getDictionary(lang);
  const localisedModuleManifest = getLocalisedData(dictionary, lang, [moduleManifest])[0];
  try {
    // TODO breaks if outDir is changed!!!
    fs.writeFileSync(`dist/${lang}/module.json`, JSON.stringify(localisedModuleManifest, null, 2));
    // TODO use the replacer to supply a translator function ?
  } catch (err) {
    console.error(err); // TODO *****
  }
}

const templatePackDirPaths = fs
  .readdirSync(config.packTemplateDir)
  .map((dirName) => path.resolve(config.packTemplateDir, dirName));

// Loads all template packs into memory
const templatePacks = templatePackDirPaths.map((dirPath) => CompendiumPack.loadYAML(dirPath));

const translatedPacks: CompendiumPack[] = [];
templatePacks.forEach((pack) => {
  targetLanguages.forEach((lang) => {
    try {
      translatedPacks.push(pack.translate(lang));
    } catch (error) {
      if (error instanceof Error) {
        throw new PackError(`Error translating pack ${pack.name} to ${lang}: \n\n${error.message}`);
      }
    }
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
