import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const exampleTool = createTool({
  id: "example-tool",
  // Describe what your tool does - this helps agents understand when to use it
  description: "A simple example tool that demonstrates how to create Mastra tools",
  // Define what inputs your tool expects
  // Use .describe() to add helpful descriptions for each field
  inputSchema: z.object({
    message: z.string().describe("A message to process"),
    count: z.number().optional().describe("Optional number parameter")
  }),
  // Define what your tool will return
  outputSchema: z.object({
    processed: z.string(),
    timestamp: z.string(),
    metadata: z.object({
      characterCount: z.number(),
      wordCount: z.number()
    })
  }),
  // The execute function contains your tool's logic
  // It receives a context object with the validated input data
  execute: async ({ context }) => {
    console.log("\u{1F527} Example tool executing with:", context);
    const processedMessage = context.message.toUpperCase();
    const words = context.message.split(" ").filter((w) => w.length > 0);
    return {
      processed: processedMessage,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      metadata: {
        characterCount: context.message.length,
        wordCount: words.length
      }
    };
  }
});

export { exampleTool };
//# sourceMappingURL=63296439-eeae-4505-99d1-2f103c57d1f3.mjs.map
