import { Response } from "express";
import fail from "../utils/fail";
import { getZidForRid } from "../utils/zinvite";

import Anthropic from "@anthropic-ai/sdk";
import {
  GenerateContentRequest,
  GoogleGenerativeAI,
} from "@google/generative-ai";
import { convertXML } from "simple-xml-to-json";
import fs from "fs/promises";
import { parse } from "csv-parse/sync";
import { create } from "xmlbuilder2";
import { sendCommentGroupsSummary } from "./export";
import { getTopicsFromRID } from "../report_experimental/topics-example";
import DynamoStorageService from "../utils/storage";

const js2xmlparser = require("js2xmlparser");

interface PolisRecord {
  [key: string]: string; // Allow any string keys
}

export class PolisConverter {
  static convertToXml(csvContent: string): string {
    // Parse CSV content
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    }) as PolisRecord[];

    if (records.length === 0) return "";

    // Create XML document
    const doc = create({ version: "1.0", encoding: "UTF-8" }).ele(
      "polis-comments"
    );

    // Process each record
    records.forEach((record) => {
      // Extract base comment data
      const comment = doc.ele("comment", {
        id: record["comment-id"],
        votes: record["total-votes"],
        agrees: record["total-agrees"],
        disagrees: record["total-disagrees"],
        passes: record["total-passes"],
      });

      // Add comment text
      comment.ele("text").txt(record["comment"]);

      // Find and process all group data
      const groupKeys = Object.keys(record)
        .filter((key) => key.match(/^group-[a-z]-/))
        .reduce((groups, key) => {
          const groupId = key.split("-")[1]; // Extract "a" from "group-a-votes"
          if (!groups.includes(groupId)) groups.push(groupId);
          return groups;
        }, [] as string[]);

      // Add data for each group
      groupKeys.forEach((groupId) => {
        comment.ele(`group-${groupId}`, {
          votes: record[`group-${groupId}-votes`],
          agrees: record[`group-${groupId}-agrees`],
          disagrees: record[`group-${groupId}-disagrees`],
          passes: record[`group-${groupId}-passes`],
        });
      });
    });

    // Return formatted XML string
    return doc.end({ prettyPrint: true });
  }

  static async convertFromFile(filePath: string): Promise<string> {
    const fs = await import("fs/promises");
    const csvContent = await fs.readFile(filePath, "utf-8");
    return PolisConverter.convertToXml(csvContent);
  }

  // Helper method to validate CSV structure
  static validateCsvStructure(headers: string[]): boolean {
    const requiredBaseFields = [
      "comment-id",
      "comment",
      "total-votes",
      "total-agrees",
      "total-disagrees",
      "total-passes",
    ];

    const hasRequiredFields = requiredBaseFields.every((field) =>
      headers.includes(field)
    );

    // Check if group fields follow the expected pattern
    const groupFields = headers.filter((h) => h.startsWith("group-"));
    const validGroupPattern = groupFields.every((field) =>
      field.match(/^group-[a-z]-(?:votes|agrees|disagrees|passes)$/)
    );

    return hasRequiredFields && validGroupPattern;
  }
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const gemeniModel = genAI.getGenerativeModel({
  // model: "gemini-1.5-pro-002",
  model: "gemini-exp-1206",
  generationConfig: {
    // https://cloud.google.com/vertex-ai/docs/reference/rest/v1/GenerationConfig
    responseMimeType: "application/json",
    maxOutputTokens: 50000, // high for reliability for now.
  },
});

const getCommentsAsXML = async (
  id: number,
  filter?: (v: {
    votes: number;
    agrees: number;
    disagrees: number;
    passes: number;
    group_aware_consensus?: number;
    comment_extremity?: number;
    comment_id: number;
  }) => boolean
) => {
  try {
    const resp = await sendCommentGroupsSummary(id, undefined, false, filter);
    const xml = PolisConverter.convertToXml(resp as string);
    // eslint-disable-next-line no-console
    if (xml.trim().length === 0) console.error("No data has been returned by sendCommentGroupsSummary");
    return xml;
  } catch (e) {
    console.error("Error in getCommentsAsXML:", e);
    throw e; // Re-throw instead of returning empty string
  }
};

// Add new type definitions
interface ReportSection {
  name: string;
  templatePath: string;
  filter?: (v: {
    votes: number;
    agrees: number;
    disagrees: number;
    passes: number;
    group_aware_consensus?: number;
    comment_extremity?: number;
    comment_id: number;
  }) => boolean;
}

// Define the report sections with filters
const getReportSections = (topics: {name: string, citations: number[]}[]) => {
  return [
    {
      name: "uncertainty",
      templatePath: "src/report_experimental/subtaskPrompts/uncertainty.xml",
      // Revert to original simple pass ratio check
      filter: (v: {passes: number, votes: number}) => v.passes / v.votes >= 0.2,
    },
    {
      name: "group_informed_consensus",
      templatePath:
        "src/report_experimental/subtaskPrompts/group_informed_consensus.xml",
      filter: (v: {group_aware_consensus: number}) => (v.group_aware_consensus ?? 0) > 0.7,
    },
    {
      name: "groups",
      templatePath: "src/report_experimental/subtaskPrompts/groups.xml",
      filter: (v: {comment_extremity: number}) => {
        return (v.comment_extremity ?? 0) > 1;
      },
    },
    ...topics.map((topic: {name: string, citations: number[]}) => ({
      name: `topic_${topic.name.toLowerCase().replace(/\s+/g, "_")}`,
      templatePath: "src/report_experimental/subtaskPrompts/topics.xml",
      filter: (v: { comment_id: number }) => {
        // Check if the comment_id is in the citations array for this topic
        return topic.citations.includes(v.comment_id);
      },
    })),
  ]
};

type QueryParams = {
  [key: string]: string | string[] | undefined;
};

const isFreshData = (timestamp: string) => {
  const now = new Date().getTime();
  const then =  new Date(timestamp).getTime();
  const elapsed = Math.abs(now - then);
  return elapsed < ((process.env.MAX_REPORT_CACHE_DURATION as unknown as number) || 3600000);
}

export async function handle_GET_reportNarrative(
  req: { p: { rid: string }; query: QueryParams },
  res: Response
) {
  let storage;
  if (process.env.AWS_REGION && process.env.AWS_REGION?.trim().length > 0) {
    storage = new DynamoStorageService(process.env.AWS_REGION, "report_narrative_store");
  }
  const sectionParam = req.query.section;
  const modelParam = req.query.model;
  let tpcs;
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Transfer-Encoding": "chunked",
  });
  const { rid } = req.p;


  res.write(`POLIS-PING: AI bootstrap`);

  // @ts-expect-error flush - calling due to use of compression
  res.flush();

  const system_lore = await fs.readFile(
    "src/report_experimental/system.xml",
    "utf8"
  );

  try {
    const zid = await getZidForRid(rid);
    if (!zid) {
      fail(res, 404, "polis_error_report_narrative_notfound");
      return;
    }

    res.write(`POLIS-PING: retrieving topics`);

    // @ts-expect-error flush - calling due to use of compression
    res.flush();
    const cachedTopics = await storage?.queryItemsByRidSectionModel(`${rid}#topics`);

    if (cachedTopics?.length && isFreshData(cachedTopics[0].timestamp)) {
      tpcs = cachedTopics[0].report_data
    } else {
      if (cachedTopics?.length) {
        storage?.deleteReportItem(cachedTopics[0].rid_section_model, cachedTopics[0].timestamp);
      }
      tpcs = await getTopicsFromRID(zid);
      const reportItemTopics = {
        rid_section_model: `${rid}#topics`,
        timestamp: new Date().toISOString(),
        report_data: tpcs,
      };
      
      storage?.putItem(reportItemTopics);
    }

    const reportSections = getReportSections(tpcs)

    res.write(`POLIS-PING: retrieving system lore`);


    // @ts-expect-error flush - calling due to use of compression
    res.flush();

    for (const section of reportSections) {
      const s = sectionParam
        ? reportSections.find((s) => s.name === sectionParam) || section
        : section;
      const cachedResponseClaude = storage?.queryItemsByRidSectionModel(`${rid}#${s.name}#claude`);
      const cachedResponseGemini =  storage?.queryItemsByRidSectionModel(`${rid}#${s.name}#gemini`);

      const fileContents = await fs.readFile(s.templatePath, "utf8");
      const json = await convertXML(fileContents);
      // @ts-expect-error function args ignore temp
      const structured_comments = await getCommentsAsXML(zid, s.filter);
      // send cached response first if avalable
      if (Array.isArray(cachedResponseClaude) && cachedResponseClaude?.length && Array.isArray(cachedResponseGemini) && cachedResponseGemini?.length && isFreshData(cachedResponseClaude[0].timestamp) && isFreshData(cachedResponseGemini[0].timestamp)) {
        res.write(
          JSON.stringify({
            [s.name]: {
              responseGemini: cachedResponseGemini[0].report_data,
              responseClaude: cachedResponseClaude[0].report_data,
              errors: structured_comments?.trim().length === 0 ? "NO_CONTENT_AFTER_FILTER" : undefined,
            },
          })
        );
      } else {
        if (Array.isArray(cachedResponseClaude) && cachedResponseClaude?.length) {
          storage?.deleteReportItem(cachedResponseClaude[0].rid_section_model, cachedResponseClaude[0].timestamp);
        }
        if (Array.isArray(cachedResponseGemini) && cachedResponseGemini?.length) {
          storage?.deleteReportItem(cachedResponseGemini[0].rid_section_model, cachedResponseGemini[0].timestamp);
        }
        json.polisAnalysisPrompt.children[
          json.polisAnalysisPrompt.children.length - 1
        ].data.content = { structured_comments };
  
        const prompt_xml = js2xmlparser.parse(
          "polis-comments-and-group-demographics",
          json
        );
  
        if ((modelParam as string)?.trim()) {
          const responseClaude = await anthropic.messages.create({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 3000,
            temperature: 0,
            system: system_lore,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: prompt_xml }],
              },
              {
                role: "assistant",
                content: [{ type: "text", text: "{" }],
              },
            ],
          });
          res.write(
            JSON.stringify({
              [s.name]: {
                responseClaude,
                errors: structured_comments?.trim().length === 0 ? "NO_CONTENT_AFTER_FILTER" : undefined,
              },
            })
          );
        } else {
          const responseClaude = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 3000,
            temperature: 0,
            system: system_lore,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: prompt_xml }],
              },
              {
                role: "assistant",
                content: [{ type: "text", text: "{" }],
              },
            ],
          });
  
          const gemeniModelprompt: GenerateContentRequest = {
            contents: [
              {
                parts: [
                  {
                    text: prompt_xml,
                  },
                ],
                role: "user",
              },
            ],
            systemInstruction: system_lore,
          };
  
          const respGem = await gemeniModel.generateContent(gemeniModelprompt);
          const responseGemini = await respGem.response.text();
  
          const reportItemClaude = {
            rid_section_model: `${rid}#${s.name}#claude`,
            timestamp: new Date().toISOString(),
            report_data: responseClaude,
            errors: structured_comments?.trim().length === 0 ? "NO_CONTENT_AFTER_FILTER" : undefined,
          };
          
          storage?.putItem(reportItemClaude);
  
          const reportItemGemini = {
            rid_section_model: `${rid}#${s.name}#gemini`,
            timestamp: new Date().toISOString(),
            report_data: responseGemini,
            errors: structured_comments?.trim().length === 0 ? "NO_CONTENT_AFTER_FILTER" : undefined,
          };
          
          storage?.putItem(reportItemGemini);
  
          res.write(
            JSON.stringify({
              [s.name]: {
                responseGemini,
                responseClaude,
                errors: structured_comments?.trim().length === 0 ? "NO_CONTENT_AFTER_FILTER" : undefined,
              },
            })
          );
        }
      }


      // @ts-expect-error flush - calling due to use of compression
      res.flush();

      if ((sectionParam as string)?.trim() && sectionParam === s.name) {
        break;
      }
    }

    res.end();
  } catch (err) {
    console.log(err);
    const msg =
      err instanceof Error && err.message && err.message.startsWith("polis_")
        ? err.message
        : "polis_err_report_narrative";
    fail(res, 500, msg, err);
  }
}
