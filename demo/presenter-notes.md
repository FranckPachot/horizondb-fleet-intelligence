# HorizonDB Fleet Intelligence Presenter Notes

These notes are embedded in the PowerPoint deck. Lines beginning with "DEMO CUE" are presenter instructions and are not intended to be spoken.

## Recording workflow

PowerPoint does not provide a reliable automatic pause of the recorder at every
slide boundary. This deck uses manual slide advancement. For preparation time
without recorded silence, record one slide at a time: choose **Record > From
Current Slide**, narrate the slide, stop recording, prepare the next slide, and
repeat. PowerPoint stores each take on its own slide and combines them during
Export. On slides 7 through 11, click the large play symbol while recording.

## Slide 1 - Title and goal

This is HorizonDB Fleet Intelligence, a customer-ready sample for shipment tracking, fleet dispatch, and security operations. The original customer question was practical: show PostGIS running on HorizonDB, then combine location with AI in an application that looks like a real development stack. This demo adds vector retrieval, four-bit spherical quantization, and a tool-driven GPT-5.4 agent without moving operational data into another search store.

## Slide 2 - Agenda

We will start with the customer scenario, then map the two application paths and inventory every HorizonDB feature in use. The live walkthrough shows a criteria search, two execution plans, and a prompt-only agent. We finish with a quick code tour and the customer value recap. Every application and plan view comes from the running React and Vite sample against live HorizonDB.

## Slide 3 - Customer context

Location alone is not enough for an operations decision. A shipment operator also needs cargo meaning, status, ETA, and current exceptions. The same pattern extends to bus or taxi dispatch, where service intent and proximity matter together, and to security response, where an incident description must be grounded in current position and service area. The sample stays generic for public reuse while directly reflecting those telecom fleet and dispatch scenarios.

## Slide 4 - Two paths and one repository

The interface deliberately separates two kinds of work. On the left, the operator enters a search prompt plus explicit status, ETA, map center, and radius criteria. That deterministic form calls `/api/search`. On the right, the operator sends only a natural-language question to `/api/chat`. Microsoft Agent Framework lets GPT-5.4 choose the arguments for one typed `search_shipments` tool. Both paths call the same asynchronous Psycopg repository, and both return exact rows to the shared list and map. Left-side criteria never leak into the agent request.

## Slide 5 - HorizonDB feature overview

Each shipment stores origin, destination, and current position as PostGIS points in SRID 4326, with GiST support and `ST_DWithin` for radius search. The HorizonDB model registry resolves `default-embedding` to `text-embedding-3-small` and `default-chat` to GPT-5.4. pgvector stores 1,536 dimensions and uses cosine distance. DiskANN is built with spherical quantization enabled, four-bit codes, and 25,000 training samples. Status and ETA B-tree indexes give the PostgreSQL planner selective alternatives. Finally, `azure_ai.generate` supplies the agent's tool-planning and grounded-answer model turns behind the same database connection.

## Slide 6 - Live application section

Now we move into the running application. The next views show the operator experience and the actual plans captured by `EXPLAIN ANALYZE` with buffer and write-ahead-log statistics.

## Slide 7 - Application overview

DEMO CUE - Click the large play symbol when you are ready. The 6.6-second silent overview clip stops on the final frame and moves across the criteria workbench, map, and agent panel.

The React and Vite console presents the separation visually. The criteria workbench is on the left, the shared Leaflet map is in the center, and the Agent Framework assistant is on the right. The live header verifies HorizonDB, PostGIS, four-bit spherical-quantized DiskANN, and Agent Framework. Search results from either path replace the shared shipment list and map markers, so evidence stays visible beside the request that produced it.

## Slide 8 - Criteria search

DEMO CUE - Click the large play symbol when you are ready. The 10-second silent criteria clip selects a West Africa map center, exception status, a 3,000-kilometer radius, enters the semantic intent, and runs the search.

For the first search, I ask for cold-chain medicine for clinics. I select exception status, center the map near West Africa, and choose a 3,000-kilometer radius. The criteria path returns one precise match: SHIP-0007, Cold-Chain Vaccines, currently near Dakar. PostGIS reports a distance of about 1,372 kilometers. Cosine similarity is 0.56, and the final hybrid score combines semantic relevance with proximity. No chat or model reasoning is needed to interpret these explicit filters.

## Slide 9 - Criteria execution plan

DEMO CUE - Click the large play symbol when you are ready. The 8.7-second silent plan clip opens Query and Plan, then points to `BitmapAnd` and the PostGIS geography GiST index.

The execution plan shows why inspectability matters. This highly selective request does not force a vector index scan. HorizonDB combines the status B-tree and the PostGIS geography GiST index with `BitmapAnd`, then verifies `ST_DWithin`. The SQL pane shows every literal, including prompt, status, coordinates, and radius. The planner correctly chooses relational and spatial selectivity for one row, while the outer query still computes the semantic and spatial hybrid score.

## Slide 10 - Agent search

DEMO CUE - Click the large play symbol when you are ready. The 8.3-second silent agent clip compresses the long model wait and shows the prompt-only request, three result cards, and selection of the second card on the map.

Next I clear the left criteria and ask the assistant, "Which delayed shipments need attention?" The captured request body contains only that question. GPT-5.4 chooses delayed as the tool status and rewrites the semantic intent to shipments needing attention. Agent Framework invokes the tool once. It returns three rows: Electric Vehicles, Apparel and Textiles, and Lithium Batteries. Those exact rows appear as cards in the answer, in the left list, and on the map. The Query and Plan button retains this turn's SQL and plan even if another search runs later.

## Slide 11 - Agent execution plan

DEMO CUE - Click the large play symbol when you are ready. The 8.6-second silent agent-plan clip opens the per-answer Query and Plan window and points to `DiskANNFilteredScan` and the three collected tuple identifiers.

The agent tool's plan provides the vector contrast. Here HorizonDB uses a custom DiskANN filtered scan. Strict iterative search applies the delayed filter and then vector ordering, collecting exactly three tuple identifiers. The query pane exposes the model-selected semantic phrase and the cosine operator. This is the spherical-quantized DiskANN path the customer wanted to see, and it remains fully inspectable rather than hidden behind the generated answer.

## Slide 12 - Two enforceable request contracts

The separation begins in the browser and is enforced again by FastAPI. The criteria function posts the prompt, status, ETA window, location, and radius to `/api/search`. Pydantic checks that location and radius, and date and tolerance, are supplied as pairs. The agent function posts only the question to `/api/chat`. Its `AgentRequest` model forbids extra fields, so adding status or map scope produces HTTP 422 before Agent Framework runs. This is not just a visual distinction; it is an application contract tested by the backend suite.

## Slide 13 - Agent Framework tool loop

The assistant uses Microsoft Agent Framework for a bounded two-turn function loop while model inference stays inside HorizonDB. On the first turn, the custom chat client asks `azure_ai.generate` for JSON matching the registered tool schema. Agent Framework validates those arguments and invokes `search_shipments`, which is limited to one call. On the second turn, the model receives only the serialized result rows and writes the grounded answer. The client caps the run at two model iterations and one function call, so the orchestration remains predictable and inspectable.

## Slide 14 - Shared hybrid query and planner choices

Both application paths call the same `semantic_search` repository method. It creates the query embedding in HorizonDB, applies optional status, ETA, and PostGIS radius predicates, preserves cosine `ORDER BY` plus `LIMIT` for DiskANN candidate retrieval, and exposes semantic, distance, and hybrid scores. The application does not force an index. For the selective criteria demo, PostgreSQL combines the status B-tree and geography GiST indexes with `BitmapAnd`. For the agent demo, it chooses `DiskANNFilteredScan` and collects exactly three tuple identifiers. Every SELECT is explained first, and the response retains the literal SQL and plan that produced its cards.

## Slide 15 - Idempotent setup and Azure deployment

The setup path makes the sample repeatable. Each row combines business attributes, three PostGIS points, JSON metadata, and a 1,536-dimensional vector. Setup upserts 24 shipments, invalidates embeddings only when semantic fields change, generates missing embeddings in batches inside HorizonDB, and builds DiskANN only when every row is ready. The index enables spherical quantization with four-bit codes and 25,000 training samples. `azd up` and Bicep provision the native HorizonDB preview cluster and separate API and React Container Apps. Post-deployment health refuses readiness unless GPT-5.4, Agent Framework, and the SQ4 index contract are all present.

## Slide 16 - Customer recap

The result is one operational database with two trustworthy ways to ask. When operators know the criteria, the left workflow keeps status, time, and geography deterministic. When intent is conversational, GPT-5.4 gets one controlled Agent Framework tool over the same repository. In both cases, rows, scores, SQL literals, and planner decisions remain visible. This pattern starts with shipment tracking and transfers directly to fleet, taxi, bus, and security dispatch without duplicating relational, spatial, vector, and AI data across separate stores.
