import chalk from 'chalk';
import {ChainedBatch, ClassicLevel} from 'classic-level';
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import * as crypto from "crypto";

import {
  i18nDir,
  outDir,
  packsMetadata,
  packTemplateDir,
  translationsFileNames,
} from "./buildPacks";
import {escapeRegex} from "./utils";
import {existsSync, promises} from "fs";

export interface PackMetadata {
  system: string;
  name: string;
  path: string;
  type: string;
}

export class PackError implements Error {
  public name: string = "PackError";

  constructor(public message: string) {
    console.error(chalk.red(`Pack Error: ${chalk.bold(message)}`));
    process.exit(1);
  }
}

type CompendiumSource = any["data"]["_source"]; // TODO *** remove or redefine type ***

export class CompendiumPack {
  name: string;
  packDir: string;
  documentType: string;
  systemId: string;
  data: any[];

  constructor(packDir: string, parsedData: unknown[], isTemplate: boolean) {
    const packName = isTemplate ? packDir + "-en" : packDir;

    const metadata = packsMetadata.find(
      (pack) => path.basename(pack.path) === path.basename(packName),
    );
    if (!metadata && !isTemplate) {
      // Don't care about the template packs, only warn about missing translated pack specifications
      throw new PackError(
        `Compendium at ${packDir} has no metadata in the "packs" section in the system.json manifest file.`,
      );
    }

    this.systemId = metadata?.system ?? "";
    this.name = metadata?.name ?? "";
    this.documentType = metadata?.type ?? "";

    if (!this.isPackData(parsedData)) {
      throw new PackError(
        `Data supplied for [${this.name}] in [${packDir}] does not resemble Foundry document source data.`,
      );
    }

    this.packDir = packDir;
    this.data = parsedData;
  }

  static loadYAML(dirPath: string): CompendiumPack {
    console.log(chalk.green(`Building pack from ${chalk.bold(dirPath)}/*.yaml`));
    const filenames = fs.readdirSync(dirPath);
    const filePaths = filenames.map((filename) => path.resolve(dirPath, filename));
    const parsedData: unknown[] = filePaths.map((filePath) => {
      const yamlString = fs.readFileSync(filePath, "utf-8");
      const yamlStringWithIncludes = includePackYaml(yamlString); // TODO the includes needs to be a separate record when writing to classic-level!
      const packSources: CompendiumSource = (() => {
        try {
          return yaml.loadAll(yamlStringWithIncludes);
        } catch (error) {
          if (error instanceof Error) {
            console.log(yamlStringWithIncludes);
            throw new PackError(`File ${filePath} could not be parsed: ${error.message}`);
          }
        }
      })();

      return packSources;
    });

    const dbFilename = path.basename(dirPath);
    return new CompendiumPack(dbFilename, parsedData.flat(), true);
  }

  private finalize(docSource: CompendiumSource, batch: ChainedBatch<ClassicLevel, string, string>) {
    const documentType2dbType = new Map([ // TODO not sure about the strings...
      ["Actor", "!actors"],
      ["Item", "!items"],
      ["JournalEntry", "!journal"],
      ["RollTable", "!tables"],
      ["Macro", "!macros"]
    ])

    const dbType = documentType2dbType.get(this.documentType);
    if (!dbType) {
      throw new PackError(`Document type ${this.documentType} is unknown`);
    }
    docSource = this.addId(docSource, dbType + "!");

    // Add _id to Descendant Documents
    if (docSource.items) { // child of Actor
      docSource.items = docSource.items.map((item: any) => {
        this.addId(item, `${dbType}.items!`, docSource._id);
        batch.put(item._key, item);
        return item._id;
      });
    }
    if (docSource.effects) { // child of Item etc.
      docSource.effects = docSource.effects.map((effect: any) => {
        this.addId(effect, `${dbType}.effects!`, docSource._id);
        batch.put(effect._key, effect);
        return effect._id;
      });
    }
    if (docSource.pages) { // child of RollTable
      docSource.pages = docSource.pages.map((page: any) => {
        this.addId(page, `${dbType}.pages!`, docSource._id);
        batch.put(page._key, page);
        return page._id;
      }); // Updates in place in docSource
    }
    if (docSource.results) { // child of RollTable
      docSource.results = docSource.results.map((result: any) => {
        this.addId(result, `${dbType}.results!`, docSource._id);
        batch.put(result._key, result);
        return result._id;
      });
    }

    batch.put(docSource._key, docSource); //add it to the DB transaction
  }

  private addId(object: any, dbLocation: string, parentId?: string): any {
    const currentObjectId: string = object._id ?? crypto
      .createHash("md5")
      .update(this.name + object.name + object.type + object.text) // Has to be unique - use data that should be unique when combined (like "cults | en - Orlanth - cult - undefined")
      .digest("base64")
      .replace(/[+=/]/g, "")
      .substring(0, 16);
    object._id = currentObjectId;
    const parentObjectId = parentId ? `${parentId}.` : "";
    const objectKey = dbLocation + parentObjectId + currentObjectId;
    object._key = objectKey;
    return object;
  }

  /**
   * Create a translated clone of this template CompendiumPack by replacing `${{key}}$` with the translations for that key & lang
   */
  translate(lang: string): CompendiumPack {
    // Include the filename in path to match the behaviour in starter set
    const dictionary = translationsFileNames.reduce((dict: any, filename: string) => {
      dict[filename] = JSON.parse(fs.readFileSync(`${i18nDir}/${lang}/${filename}.json`, "utf8"));
      return dict;
    }, {});

    const localisedPackDir = `${this.packDir}-${lang}`;
    const localisedData = this.data.map((d) => {
      const translated = JSON.stringify(d).replace(
        /\$\{\{ ?([\w\-.]+) ?}}\$/g,
        function (match: string, key: string) {
          const translation = lookup(dictionary, key);

          if (translation == null) {
            console.error(match, "translation key missing in language", lang);
          }
          return translation ?? match;
        },
      );
      try {
        return JSON.parse(translated);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Unable to parse translated JSON ${translated}\n\n${error.message}`);
        }
      }
    });

    // clone this CompendiumPack
    return new CompendiumPack(localisedPackDir, localisedData, false);
  }

  async save(): Promise<number> {
    //create DB and grab a transaction
    const dbPath = path.join(outDir, this.packDir);
    const db = new ClassicLevel(dbPath, {keyEncoding: 'utf8', valueEncoding: 'json'});
    const batch = db.batch();

    //attempt to clear the DB files if they already exist.
    if (existsSync(dbPath)) {
      await promises.rm(dbPath, {recursive: true})
    }

    for (const doc of this.data) {
      this.finalize(doc, batch);
    }

    //commit and close the DB
    await batch.write();
    await _compactClassicLevel(db);
    await db.close();
    console.log(chalk.green(`Wrote ${chalk.bold(this.name)} with ${chalk.bold(this.data.length)} entries to db!`));

    return this.data.length;
  }

  private isDocumentSource(maybeDocSource: unknown): maybeDocSource is CompendiumSource {
    if (!isObject(maybeDocSource)) {
      return false;
    }
    const checks = Object.entries({
      name: (data: { name?: unknown }) => typeof data.name === "string",
      flags: (data: unknown) => typeof data === "object" && data !== null && "flags" in data,
      permission: (data: { permission?: { default: unknown } }) =>
        !data.permission ||
        (typeof data.permission === "object" &&
          data.permission != null &&
          Object.keys(data.permission).length === 1 &&
          Number.isInteger(data.permission.default)),
    });

    const failedChecks = checks
      .map(([key, check]) => (check(maybeDocSource as any) ? null : key))
      .filter((key) => key !== null);

    if (failedChecks.length > 0) {
      throw new PackError(
        `Document source [${(maybeDocSource as any)?.name}] in (${
          this.name
        }) has invalid or missing keys: ${failedChecks.join(", ")}`,
      );
    }

    return true;
  }

  private isPackData(packData: unknown[]): packData is CompendiumSource[] {
    return packData.every((maybeDocSource: unknown) => this.isDocumentSource(maybeDocSource));
  }
}

/**
 * Translate a key given a dictionary.
 * @return {string} translated text
 */
function lookup(dict: any, key: string): string {
  const keyParts = key.split(".");

  const value = keyParts.reduce(function (acc, keyPart) {
    return acc[keyPart];
  }, dict);

  return value;
}

export function isObject(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

function includePackYaml(yamlString: string): string {
  const tokenRegex =
    /"\|{{\s*(?<packName>[\w+./-]+)\s+(?<rqid>[\w.-]+)\s+\[\s+(?<override>[^[]*)?]\s*}}\|"/gm;

  return yamlString.replace(tokenRegex, replaceLinkedDocs);
}

function replaceLinkedDocs(
  match: string,
  packName: string | undefined,
  rqid: string | undefined,
  override: string | undefined,
): string {
  if (!packName || !rqid) {
    console.error(
      `Missing packName [${packName}] or Rqid [${rqid}] when matching token [${match}]`,
    );
    return "";
  }
  const overrides = override?.split(",").map((item) => item.trim()) ?? [];
  const packTemplate = path.resolve(packTemplateDir + "/" + packName);

  const packTemplateYamlString = packTemplate ? fs.readFileSync(packTemplate, "utf-8") : undefined;
  const packEntries = packTemplateYamlString?.split("---") ?? [];
  const rqidRegex = new RegExp(`^\\s*id:\\s+${escapeRegex(rqid)}$`, "m");

  for (const entry of packEntries) {
    if (rqidRegex.test(entry)) {
      // Add two spaces to every line to indent it properly
      let cleanEntry = entry.replace(/\r/, "").replace(/\n/gm, "\n  ");

      for (const override of overrides) {
        const [overrideKey, overrideValue] = override.split(":").map((item) => item.trim());
        const overrideRegex = new RegExp(`(${escapeRegex(overrideKey)}:\\s*)(.+)`, "m");
        cleanEntry = cleanEntry.replace(overrideRegex, (match, xxx: string) => xxx + overrideValue);
      }
      return cleanEntry;
    }
  }

  // Didn't find an entry
  console.error(
    `Did not find an entry in the pack [${chalk.bold(packName)}] with an RQID of [${chalk.bold(rqid)}] to match the token [${chalk.bold(match)}]`,
  );
  return "";
}

/**
 * Flushes the log of the given database to create compressed binary tables.
 * @param {ClassicLevel} db The database to compress.
 * @returns {Promise<void>}
 * @private
 */
async function _compactClassicLevel(db: ClassicLevel<string, string>) {
  const forwardIterator = db.keys({limit: 1, fillCache: false});
  const firstKey = await forwardIterator.next();
  await forwardIterator.close();

  const backwardIterator = db.keys({limit: 1, reverse: true, fillCache: false});
  const lastKey = await backwardIterator.next();
  await backwardIterator.close();

  if (firstKey && lastKey) {
    return db.compactRange(firstKey, lastKey, {keyEncoding: "utf8"});
  }
}
