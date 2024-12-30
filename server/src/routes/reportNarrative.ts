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
import { topicsExample } from "../prompts/topics-example";

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
  model: "gemini-1.5-pro-002",
  generationConfig: {
    responseMimeType: "application/json",
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
const reportSections: ReportSection[] = [
  {
    name: "uncertainty",
    templatePath: "src/prompts/report_experimental/subtasks/uncertainty.xml",
    // Revert to original simple pass ratio check
    filter: (v) => v.passes / v.votes >= 0.2,
  },
  {
    name: "group_informed_consensus",
    templatePath:
      "src/prompts/report_experimental/subtasks/group_informed_consensus.xml",
    filter: (v) => (v.group_aware_consensus ?? 0) > 0.7,
  },
  {
    name: "groups",
    templatePath: "src/prompts/report_experimental/subtasks/groups.xml",
    filter: (v) => {
      return (v.comment_extremity ?? 0) > 1;
    },
  },
  ...topicsExample.topics.map((topic) => ({
    name: `topic_${topic.name.toLowerCase().replace(/\s+/g, "_")}`,
    templatePath: "src/prompts/report_experimental/subtasks/topics.xml",
    filter: (v: { comment_id: number }) => {
      // Check if the comment_id is in the citations array for this topic
      return topic.citations.includes(v.comment_id);
    },
  })),
];

type QueryParams = {
  [key: string]: string | string[] | undefined;
};

export async function handle_GET_reportNarrative(
  req: { p: { rid: string }; query: QueryParams },
  res: Response
) {
  const sectionParam = req.query.section;
  const modelParam = req.query.model;
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Transfer-Encoding": "chunked",
  });
  const { rid } = req.p;

  res.write(`POLIS-PING: AI bootstrap`);

  // @ts-expect-error flush - calling due to use of compression
  res.flush();

  try {
    const zid = await getZidForRid(rid);
    if (!zid) {
      fail(res, 404, "polis_error_report_narrative_notfound");
      return;
    }

    res.write(`POLIS-PING: retrieving system lore`);

    const system_lore = await fs.readFile(
      "src/prompts/report_experimental/system.xml",
      "utf8"
    );

    // @ts-expect-error flush - calling due to use of compression
    res.flush();

    console.log("Request received. Generating report sections with topics:", {
      totalSections: reportSections.length,
      topicSections: reportSections.map((s) => s.name),
    });

    for (const section of reportSections) {
      const s = sectionParam
        ? reportSections.find((s) => s.name === sectionParam) || section
        : section;
      const fileContents = await fs.readFile(s.templatePath, "utf8");
      const json = await convertXML(fileContents);
      const structured_comments = await getCommentsAsXML(zid, s.filter);

      json.polisAnalysisPrompt.children[
        json.polisAnalysisPrompt.children.length - 1
      ].data.content = { structured_comments };

      const prompt_xml = js2xmlparser.parse(
        "polis-comments-and-group-demographics",
        json
      );

      if (s.name.startsWith("topic_")) {
        console.log("Processing topic section:", {
          name: s.name,
          hasFilter: !!s.filter,
          templatePath: s.templatePath,
          timestamp: new Date().toISOString(),
        });
      }

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

        if (s.name.startsWith("topic_")) {
          console.log("Topic section response written:", {
            name: s.name,
            responseLength: JSON.stringify({
              [s.name]: {
                responseGemini,
                responseClaude,
              },
            }).length,
            timestamp: new Date().toISOString(),
          });
        }

        res.write(
          JSON.stringify({
            [s.name]: {
              responseGemini,
              responseClaude,
            },
          })
        );
      }

      // @ts-expect-error flush - calling due to use of compression
      res.flush();

      if ((sectionParam as string)?.trim() && sectionParam === s.name) {
        break;
      }
    }

    res.end();
  } catch (err) {
    const msg =
      err instanceof Error && err.message && err.message.startsWith("polis_")
        ? err.message
        : "polis_err_report_narrative";
    fail(res, 500, msg, err);
  }
}
