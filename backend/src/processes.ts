import { promises as fs } from "node:fs";
import path from "node:path";
import {
  BPMN_DIR,
  PLANS_DIR,
  PROCESS_KEY_RE,
  TAGS_DIR,
  bpmnPathFor,
  tagsPathFor,
} from "./config.ts";
import { deletePlan } from "./plans.ts";
import { clearTagsCache } from "./tags.ts";

export interface ProcessSummary {
  key: string;
  name: string;
  description: string;
  updatedAt: string;
}

export interface ProcessFullDef {
  key: string;
  name: string;
  description: string;
  bpmnXml: string;
  tags: {
    processKey: string;
    elementTests: Record<string, unknown>;
  };
  updatedAt: string;
}

async function readProcessMetaFromBpmn(filePath: string): Promise<{
  name: string;
  description: string;
}> {
  try {
    const xml = await fs.readFile(filePath, "utf8");
    const nameMatch =
      /<bpmn:process[^>]*\bname="([^"]+)"/.exec(xml) ??
      /<bpmn:process[^>]*\bid="([^"]+)"/.exec(xml);
    const docMatch = /<bpmn:documentation[^>]*>([\s\S]*?)<\/bpmn:documentation>/.exec(
      xml,
    );
    return {
      name: nameMatch ? nameMatch[1] : path.basename(filePath, ".bpmn"),
      description: docMatch ? docMatch[1].trim() : "",
    };
  } catch {
    return { name: path.basename(filePath, ".bpmn"), description: "" };
  }
}

export async function ensureDirs() {
  await fs.mkdir(BPMN_DIR, { recursive: true });
  await fs.mkdir(TAGS_DIR, { recursive: true });
  await fs.mkdir(PLANS_DIR, { recursive: true });
}

export async function listProcesses(): Promise<ProcessSummary[]> {
  await ensureDirs();
  const files = await fs.readdir(BPMN_DIR);
  const bpmns = files.filter((f) => f.endsWith(".bpmn"));
  const out: ProcessSummary[] = [];
  for (const f of bpmns) {
    const full = path.join(BPMN_DIR, f);
    const stat = await fs.stat(full);
    const key = path.basename(f, ".bpmn");
    const meta = await readProcessMetaFromBpmn(full);
    out.push({
      key,
      name: meta.name,
      description: meta.description,
      updatedAt: stat.mtime.toISOString(),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function getProcess(key: string): Promise<ProcessFullDef | null> {
  await ensureDirs();
  const bpmnPath = bpmnPathFor(key);
  let xml: string;
  try {
    xml = await fs.readFile(bpmnPath, "utf8");
  } catch {
    return null;
  }
  const stat = await fs.stat(bpmnPath);
  let tags: ProcessFullDef["tags"] = { processKey: key, elementTests: {} };
  try {
    const raw = await fs.readFile(tagsPathFor(key), "utf8");
    tags = JSON.parse(raw);
  } catch {}
  const meta = await readProcessMetaFromBpmn(bpmnPath);
  return {
    key,
    name: meta.name,
    description: meta.description,
    bpmnXml: xml,
    tags,
    updatedAt: stat.mtime.toISOString(),
  };
}

export function validateKey(key: string) {
  if (!PROCESS_KEY_RE.test(key)) {
    throw new Error(
      "process key must start with a lowercase letter and contain only [a-z0-9_], length 2-64",
    );
  }
}

export interface UpsertInput {
  key: string;
  bpmnXml: string;
  tags: { processKey: string; elementTests: Record<string, unknown> };
}

export async function upsertProcess(input: UpsertInput): Promise<ProcessFullDef> {
  validateKey(input.key);
  await ensureDirs();
  if (!input.bpmnXml || !input.bpmnXml.includes("<bpmn:process")) {
    throw new Error("bpmnXml is missing or does not look like a BPMN 2.0 process");
  }
  if (!input.tags || typeof input.tags !== "object") {
    throw new Error("tags must be an object");
  }
  const normalizedTags = {
    processKey: input.key,
    elementTests: input.tags.elementTests ?? {},
  };
  await atomicWrite(bpmnPathFor(input.key), input.bpmnXml);
  await atomicWrite(tagsPathFor(input.key), JSON.stringify(normalizedTags, null, 2));
  clearTagsCache(input.key);
  const result = await getProcess(input.key);
  if (!result) throw new Error("process not found after save");
  return result;
}

export async function renameProcess(
  key: string,
  newName: string,
): Promise<ProcessFullDef> {
  validateKey(key);
  const name = newName.trim();
  if (!name) throw new Error("name must not be empty");
  const bpmnPath = bpmnPathFor(key);
  let xml: string;
  try {
    xml = await fs.readFile(bpmnPath, "utf8");
  } catch {
    throw new Error(`process not found: ${key}`);
  }
  const safe = name.replace(/[<>&"]/g, " ");
  if (/<bpmn:process[^>]*\bname="[^"]*"/.test(xml)) {
    xml = xml.replace(
      /(<bpmn:process[^>]*\bname=")[^"]*(")/,
      `$1${safe}$2`,
    );
  } else {
    xml = xml.replace(/<bpmn:process\b/, `<bpmn:process name="${safe}"`);
  }
  await atomicWrite(bpmnPath, xml);
  clearTagsCache(key);
  const result = await getProcess(key);
  if (!result) throw new Error("process not found after rename");
  return result;
}

export async function deleteProcess(key: string) {
  validateKey(key);
  await fs.rm(bpmnPathFor(key), { force: true });
  await fs.rm(tagsPathFor(key), { force: true });
  await deletePlan(key);
  clearTagsCache(key);
}

async function atomicWrite(file: string, contents: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, file);
}

export function blankBpmnXml(key: string, name: string): string {
  const safe = name.replace(/[<>&"]/g, " ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                  id="Definitions_${key}"
                  targetNamespace="http://qaflow/bpmn">
  <bpmn:process id="${key}" name="${safe}" isExecutable="true">
    <bpmn:startEvent id="start" name="Start">
      <bpmn:outgoing>flow_start_end</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:endEvent id="end" name="End">
      <bpmn:incoming>flow_start_end</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_start_end" sourceRef="start" targetRef="end"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${key}">
      <bpmndi:BPMNShape id="start_di" bpmnElement="start">
        <dc:Bounds x="160" y="180" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="end_di" bpmnElement="end">
        <dc:Bounds x="320" y="180" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="flow_start_end_di" bpmnElement="flow_start_end">
        <di:waypoint x="196" y="198"/>
        <di:waypoint x="320" y="198"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
