import chalk from 'chalk';
import { existsSync, promises } from 'fs';
import * as path from "path";
import * as fs from "fs";
import {CompendiumPack, PackError, PackMetadata} from "./compendium-pack";

export const i18nDir = "module/i18n";
export const translationsFileNames: string[] = ["uiContent", "rqgCompendiumContent"];
export const outDir = path.resolve(process.cwd(), "dist/packs");

//check if the output directory exists, and create it if necessary
if (!await existsSync(outDir)) {
  await promises.mkdir(outDir, {recursive: true})
}
export const packsMetadata = JSON.parse(fs.readFileSync(path.resolve("./module/module.json"), "utf-8"))
  .packs as PackMetadata[];
export const packTemplateDir = "./pack-templates";
const targetLanguages = fs.readdirSync(i18nDir).filter((file) => {
  return fs.statSync(path.join(i18nDir, file)).isDirectory();
});

const templatePacksDataPath = path.resolve(path.resolve(packTemplateDir));
const templatePackDirPaths = fs
  .readdirSync(templatePacksDataPath)
  .map((dirName) => path.resolve(path.resolve(templatePacksDataPath, dirName)));

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

// TODO handle async saves ***
// const entityCounts = translatedPacks.map( (pack) => await pack.save());
let total = 0;
for (const pack of translatedPacks) {
  total += await pack.save();
}

// const total = entityCounts.reduce((runningTotal: number, entityCount: number) => runningTotal + entityCount, 0);

if (translatedPacks.length > 0) {
  const languageCount = targetLanguages.length;
  console.log(chalk.green(
    `Created ${chalk.bold(translatedPacks.length)} packs with ${chalk.bold(
      total / languageCount
    )} documents per language in ${chalk.bold(languageCount)} languages.`,
  ));
} else {
  throw new PackError("No data available to build packs.");
}
