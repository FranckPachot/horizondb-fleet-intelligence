# HorizonDB Fleet Intelligence Demo

This customer package contains the final presentation and narrated demo:

- `demo-slides.html`: title, agenda, architecture, retrieval, agent, and close slides.
- `fleet-intelligence-demo.mp4`: a concise walkthrough under ten minutes.

## Story

The approximately three-minute video covers:

1. Fleet, dispatch, and security-response use cases.
2. React, FastAPI, Psycopg, and Azure HorizonDB architecture.
3. PostGIS SRID 4326 points, GiST, and map-selected radius search.
4. Built-in embeddings and spherical-quantized DiskANN candidate retrieval.
5. Hybrid semantic/spatial ranking with inspectable evidence.
6. A typed agent tool and grounded generation through `azure_ai.generate`.
7. How the pattern generalizes beyond shipment tracking.

The repository intentionally excludes narration, source captures, provenance,
and build automation. Those production inputs remain under the gitignored
`internal/` directory and are not part of the customer deliverable.
