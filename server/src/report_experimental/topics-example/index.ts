// This JSON structure represents topics from the Bowling Green 2050 discussion
// Each topic includes:
//   - name: The main topic name
//   - citations: All comment IDs associated with this topic (including subtopic citations)
//   - subtopics: Array of subtopics, each with their specific citations

import { sendCommentGroupsSummary } from "../../routes/export";
import { getCommentsFromCsv } from "./lib/sensemaking-tools/runner-cli/runner_utils";
import { VertexModel } from "./lib/sensemaking-tools/src/models/vertex_model";
import { Sensemaker } from "./lib/sensemaking-tools/src/sensemaker";
import { Comment, VoteTally } from "./lib/sensemaking-tools/src/types";
import { parse } from "csv-parse";

// Citations may appear multiple times if they relate to multiple topics/subtopics
export const topicsExample = {
  topics: [
    {
      name: "Infrastructure",
      citations: [
        5,
        55,
        79,
        150,
        189,
        190,
        268,
        145,
        146,
        189,
        336,
        180,
        73,
        81,
        173,
        174,
        178,
        187,
        287,
        85,
        179,
        27,
        42,
        103,
        194,
        241,
        36,
        117,
        28,
        223,
        224,
        45,
        155,
      ],
      subtopics: [
        {
          name: "Public Transit",
          citations: [5, 55, 79, 150, 189, 190, 268, 145, 146, 189, 336],
        },
        {
          name: "Sidewalks And Parking",
          citations: [180],
        },
        {
          name: "Road Infrastructure",
          citations: [73, 81, 173, 174, 178, 187, 287, 85, 179],
        },
        {
          name: "Green Spaces",
          citations: [27, 42, 103, 194, 241],
        },
        {
          name: "Riverfront Development",
          citations: [36, 117, 28, 223, 224],
        },
        {
          name: "Signage",
          citations: [45, 155],
        },
      ],
    },
    {
      name: "Economy",
      citations: [
        136,
        135,
        17,
        164,
        133,
        352,
        19,
        31,
        292,
        110,
        210,
        213,
        104,
        203,
        14,
        359,
        358,
        209,
        360,
        207,
        208,
      ],
      subtopics: [
        {
          name: "Tourism",
          citations: [136, 135, 17, 164, 133, 352],
        },
        {
          name: "Diversified Businesses",
          citations: [19, 31, 292, 110],
        },
        {
          name: "Entrepreneurship",
          citations: [210, 213, 104, 203],
        },
        {
          name: "Job Growth",
          citations: [14, 359, 358],
        },
        {
          name: "Workforce Development",
          citations: [209, 359, 360, 207, 208],
        },
      ],
    },
    {
      name: "Community",
      citations: [
        0,
        205,
        168,
        355,
        3,
        40,
        356,
        162,
        163,
        9,
        21,
        41,
        58,
        35,
        52,
        169,
        247,
        2,
        184,
        353,
      ],
      subtopics: [
        {
          name: "Collaboration",
          citations: [0, 205, 168, 355],
        },
        {
          name: "Welcoming Environment",
          citations: [3, 40, 356, 162, 163],
        },
        {
          name: "Diversity",
          citations: [9, 21, 41, 58, 162, 163],
        },
        {
          name: "Preservation Of Existing Neighborhoods",
          citations: [35, 52, 169, 247],
        },
        {
          name: "Southern Hospitality",
          citations: [2, 184, 353],
        },
      ],
    },
    {
      name: "Arts And Culture",
      citations: [
        49,
        70,
        250,
        265,
        256,
        257,
        264,
        83,
        221,
        222,
        32,
        348,
        93,
        98,
        234,
        26,
      ],
      subtopics: [
        {
          name: "Art Galleries And Museums",
          citations: [49, 70, 250, 265, 256, 257, 264],
        },
        {
          name: "Cultural And Art Festivals",
          citations: [83, 221, 222],
        },
        {
          name: "Live Music Venues",
          citations: [32, 348, 93],
        },
        {
          name: "Public Art",
          citations: [98, 234],
        },
        {
          name: "Arts And Entertainment District",
          citations: [26],
        },
      ],
    },
    {
      name: "Education",
      citations: [
        14,
        357,
        57,
        245,
        95,
        236,
        119,
        148,
        64,
        82,
        59,
        112,
        340,
        47,
        341,
        41,
      ],
      subtopics: [
        {
          name: "WKU Programs",
          citations: [14, 357],
        },
        {
          name: "Public Education Resources",
          citations: [57, 245],
        },
        {
          name: "K-12 Education",
          citations: [95, 236, 119, 148],
        },
        {
          name: "Private Education Options",
          citations: [64, 82, 59],
        },
        {
          name: "Pre-K Options",
          citations: [112, 340],
        },
        {
          name: "Student Support Network",
          citations: [47],
        },
        {
          name: "Collaboration Between WKU And Local Businesses",
          citations: [341],
        },
        {
          name: "ESL Support",
          citations: [41],
        },
      ],
    },
    {
      name: "Food And Dining",
      citations: [
        16,
        249,
        11,
        120,
        338,
        343,
        344,
        331,
        191,
        337,
        339,
        15,
        23,
        46,
        211,
        124,
      ],
      subtopics: [
        {
          name: "Farm-To-Table Restaurants",
          citations: [16, 249],
        },
        {
          name: "Allergen-Friendly And Organic Food",
          citations: [11, 120, 338, 343, 344, 331],
        },
        {
          name: "International Cuisine",
          citations: [191, 337, 339, 15, 23],
        },
        {
          name: "Food Deserts",
          citations: [46, 211, 124],
        },
        {
          name: "Korean Restaurants",
          citations: [15, 23],
        },
      ],
    },
    {
      name: "Housing",
      citations: [87, 192, 276, 334, 97, 280, 215, 13, 25, 50, 281],
      subtopics: [
        {
          name: "Affordable Housing",
          citations: [87, 192, 276, 334, 97],
        },
        {
          name: "Multi-Family Housing",
          citations: [280, 215, 13, 25],
        },
        {
          name: "Housing Options",
          citations: [50],
        },
        {
          name: "Single-Family Homes",
          citations: [25, 13, 281],
        },
      ],
    },
    {
      name: "Healthcare",
      citations: [102, 74, 99, 101, 18],
      subtopics: [
        {
          name: "Healthcare Specialists",
          citations: [102],
        },
        {
          name: "Mental Health Services",
          citations: [74],
        },
        {
          name: "Healthcare Facilities",
          citations: [99, 101],
        },
        {
          name: "Access To Healthcare",
          citations: [18],
        },
      ],
    },
    {
      name: "Other",
      citations: [
        123,
        338,
        342,
        343,
        344,
        345,
        346,
        30,
        153,
        4,
        157,
        248,
        166,
        278,
        39,
        273,
        53,
        72,
        75,
        89,
        201,
        217,
        293,
        71,
        306,
        362,
        363,
        51,
        37,
        142,
        20,
        109,
        143,
        84,
        371,
        372,
        38,
        63,
        160,
        80,
        277,
        66,
        290,
        43,
        298,
        92,
        340,
        54,
        67,
        127,
        141,
      ],
      subtopics: [
        {
          name: "Shopping Options",
          citations: [123, 338, 342, 343, 344, 345, 346, 30, 153],
        },
        {
          name: "Neighborhood Identity",
          citations: [4, 157, 248, 166, 278],
        },
        {
          name: "Beautification",
          citations: [39, 273],
        },
        {
          name: "Downtown Parking",
          citations: [53, 72, 75, 89, 201, 217, 293],
        },
        {
          name: "Outdoor Activities",
          citations: [71, 306],
        },
        {
          name: "Nightlife",
          citations: [362, 363, 51],
        },
        {
          name: "Homelessness",
          citations: [37, 142, 20, 109, 143, 84],
        },
        {
          name: "Airport Transportation",
          citations: [371, 372, 38],
        },
        {
          name: "Indoor Attractions",
          citations: [63, 160],
        },
        {
          name: "Tech Hub",
          citations: [80, 277],
        },
        {
          name: "Vacant Buildings",
          citations: [66, 290],
        },
        {
          name: "Food Pantries",
          citations: [43, 298, 92],
        },
        {
          name: "Childcare",
          citations: [340],
        },
        {
          name: "Out Of Home Advertising",
          citations: [54],
        },
        {
          name: "Children's Museum",
          citations: [67],
        },
        {
          name: "Panhandling",
          citations: [127],
        },
        {
          name: "Disaster Preparedness",
          citations: [141],
        },
      ],
    },
  ],
};

async function parseCsvString(csvString: string) {
  return new Promise((resolve, reject) => {
    const data: Comment[] = [];
    const parser = parse({
      columns: true, // Use first row as headers
      skip_empty_lines: true, // Ignore empty lines
    });

    parser.on("error", (error) => reject(error));

    parser.on("data", (row) => {
      if (row.moderated == -1) {
        return;
      }
      data.push({
        text: row.comment_text,
        id: row["comment-id"].toString(),
        voteTalliesByGroup: {
          "group-0": new VoteTally(
            Number(row["group-0-agree-count"]),
            Number(row["group-0-disagree-count"]),
            Number(row["group-0-pass-count"])
          ),
          "group-1": new VoteTally(
            Number(row["group-1-agree-count"]),
            Number(row["group-1-disagree-count"]),
            Number(row["group-1-pass-count"])
          ),
        },
      });
    });

    parser.on("end", () => resolve(data));

    // Write the CSV string to the parser
    parser.write(csvString);
    parser.end(); // Signal the end of the input
  });
}

export async function getTopicsFromRID(zId: number) {
  const resp = await sendCommentGroupsSummary(zId, undefined, false);
  const modified = (resp as string).split("\n");
  modified[0] = `comment-id,comment_text,total-votes,total-agrees,total-disagrees,total-passes,group-a-votes,group-0-agree-count,group-0-disagree-count,group-0-pass-count,group-b-votes,group-1-agree-count,group-1-disagree-count,group-1-pass-count`;
  
  const comments = await parseCsvString(modified.join("\n"));
  const topics = await new Sensemaker({
    defaultModel: new VertexModel(
      "jigsaw-vertex-integration",
      "us-central1",
      // "jigsaw-vertex-integration-92ef30330cf7"
    ),
  }).learnTopics(comments as Comment[], true);
  return topics;
}










