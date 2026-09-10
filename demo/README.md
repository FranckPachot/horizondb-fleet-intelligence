# HorizonDB Fleet Intelligence Demo

This customer package contains the final presentation and demo recordings:

- `fleet-intelligence-demo.pptx`: the 16-slide PowerPoint deck with presenter
	notes and five embedded, silent demo clips.
- `fleet-intelligence-slides.html`: a keyboard-navigable 16-slide customer deck.
- `fleet-intelligence-demo-live.mp4`: the live end-to-end application walkthrough.
- `fleet-intelligence-demo-generated.mp4`: the 7 minute 45 second generated-voice walkthrough.
- `presenter-notes.md`: the same speaking script in a reviewable text format.
- `media/`: live 1920 x 1080 application and execution-plan captures used by the deck.

Open `fleet-intelligence-slides.html` in a browser and use the arrow keys, Page Up,
Page Down, Home, or End to navigate.

## Record With PowerPoint

PowerPoint does not have a reliable standard deck setting that pauses the
recorder at every slide boundary. Manual slide advance stops the presentation
from moving on, but the recorder continues to capture elapsed time.

For clean preparation time between slides, record one slide at a time:

1. Open `fleet-intelligence-demo.pptx` on the slide to record.
2. Choose **Record > From Current Slide**.
3. Read the presenter notes, perform any demo cue, and stop the recording.
4. Move to the next slide, prepare, and repeat.

PowerPoint stores narration and timing on each slide and combines the individual
takes during Export. To redo one take, use **Record > Clear > Clear Recording on
Current Slide**, then record that slide again.

PowerPoint displays the notes for each slide in Presenter View. Slides 7 through
11 contain embedded silent videos, visibly marked with a large play symbol:

1. Application overview.
2. Criteria search with status and PostGIS radius selection.
3. Criteria execution plan with the B-tree plus GiST `BitmapAnd`.
4. Prompt-only Agent Framework search with shipment cards.
5. Agent query plan with `DiskANNFilteredScan` and three collected TIDs.

The videos are configured for autoplay, but PowerPoint Record view can wait for
presenter input depending on Office playback settings. Click the large play
symbol when each demo slide appears. The videos are intentionally short and stop
on their final frame. Slide advance remains manual, so finish the corresponding
speaker notes before continuing. Lines beginning with `DEMO CUE` are presenter
instructions and should not be read aloud.

## Story

The video covers:

1. Fleet, dispatch, and security-response customer context.
2. Separate left-side criteria search and right-side prompt-only agent workflows.
3. React, Vite, FastAPI, Microsoft Agent Framework, Psycopg, and HorizonDB architecture.
4. PostGIS SRID 4326 points, GiST, and map-selected radius search.
5. Model registry aliases for `text-embedding-3-small` and `gpt-5.4`.
6. pgvector plus four-bit spherical-quantized DiskANN retrieval.
7. A live criteria search and its B-tree, bitmap, and PostGIS execution plan.
8. A live Agent Framework search with shipment cards and a per-answer `Query + plan` control.
9. The agent's `DiskANNFilteredScan`, shared repository query, SQ index setup, and recap.
10. Native HorizonDB and Container Apps deployment through `azd` and Bicep.

The repository intentionally excludes narration, source captures, provenance,
and build automation. Those production inputs remain under the gitignored
`internal/` directory and are not part of the customer deliverable.
