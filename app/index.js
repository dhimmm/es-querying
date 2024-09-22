const fastify = require("fastify")({ logger: true });
const { Client } = require("@elastic/elasticsearch");
const fs = require("fs");
const path = require("path");

// Elasticsearch client initialization
const esClient = new Client({ node: "http://elasticsearch:9200" });

// Index configuration
const indexConfig = {
  index: "autocomplete",
  body: {
    settings: {
      analysis: {
        filter: {
          autocomplete_filter: {
            type: "edge_ngram",
            min_gram: 2,
            max_gram: 20,
          },
        },
        analyzer: {
          autocomplete: {
            type: "custom",
            tokenizer: "standard",
            filter: ["lowercase", "autocomplete_filter"],
          },
        },
      },
    },
    mappings: {
      properties: {
        suggest: {
          type: "text",
          analyzer: "autocomplete",
          search_analyzer: "standard",
          fielddata: true,
        },
      },
    },
  },
};

// Create index API
fastify.post("/create-index", async (req, reply) => {
  try {
    const { body: indexExists } = await esClient.indices.exists({
      index: "autocomplete",
    });

    if (!indexExists) {
      await esClient.indices.create(indexConfig);
      reply.send({ message: "Index created successfully" });
    } else {
      reply.send({ message: "Index already exists" });
    }
  } catch (error) {
    reply.status(500).send({
      message: "Error creating index",
      error: error.meta ? error.meta.body : error,
    });
  }
});

// Bulk insert words into index
fastify.post("/insert-words", async (req, reply) => {
  try {
    const filePath = path.join(__dirname, "words.txt");
    const fileContent = fs.readFileSync(filePath, "utf8");
    const words = fileContent.split(/\r?\n/).filter(Boolean);

    // Bulk index the words
    const body = words.flatMap((word) => [
      { index: { _index: "autocomplete" } },
      { suggest: word },
    ]);

    const { body: bulkResponse } = await esClient.bulk({ refresh: true, body });

    if (bulkResponse.errors) {
      reply.status(500).send({
        message: "Errors occurred while inserting words",
        errors: bulkResponse.errors,
      });
    } else {
      reply.send({ message: "Words inserted successfully" });
    }
  } catch (error) {
    reply.status(500).send({ message: "Error inserting words", error });
  }
});

// Autocomplete API with typo tolerance
fastify.get("/autocomplete", async (req, reply) => {
  const { query } = req.query;

  try {
    const result = await esClient.search({
      index: "autocomplete",
      body: {
        query: {
          bool: {
            must: [
              {
                match: {
                  suggest: {
                    query: query,
                    fuzziness: query.length >= 7 ? 3 : 1, // Allow up to 3 typos for words longer than 7 characters
                  },
                },
              },
            ],
          },
        },
      },
    });

    const suggestions = result.hits.hits.map((hit) => hit._source.suggest);
    if (suggestions.length) {
      reply.send(suggestions);
    } else {
      reply.status(404).send({ message: "No suggestions found" });
    }
  } catch (error) {
    reply.status(500).send({ message: "Error occurred during search", error });
  }
});

// Server start
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: "0.0.0.0" });
    fastify.log.info("Server is running at http://localhost:3000");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
