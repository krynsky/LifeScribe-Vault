# Adding a new extractor

1. Create `apps/backend/src/lifescribe/ingest/extractors/<format>.py`
   with a class that satisfies the `Extractor` protocol from
   `lifescribe.ingest.extractors.base`:

   ```python
   from typing import ClassVar
   from pathlib import Path
   from lifescribe.ingest.extractors.base import ExtractionResult

   class MyExtractor:
       mimes: ClassVar[tuple[str, ...]] = ("application/x-my",)
       NAME: ClassVar[str] = "my"
       VERSION: ClassVar[str] = "0.1.0"

       def extract(self, path: Path) -> ExtractionResult:
           ...
           return ExtractionResult(
               body_markdown=body,
               extractor=f"{self.NAME}@{self.VERSION}",
               confidence=0.9,
           )
   ```

2. Register it in
   `apps/backend/src/lifescribe/ingest/registry_default.py`.

3. Add a fixture under `apps/backend/tests/ingest/fixtures/` (a
   tmp-path fixture in `tests/ingest/conftest.py` is fine for
   dynamically-generated files).

4. Write a unit test asserting body rendering, extractor
   name/version, confidence, and any frontmatter fields.

5. If the MIME is not already in `mime.py`'s extension map, add it.

6. Run `cd apps/backend && uv run pytest tests/ingest -v`.

## Routed extractors

Rich document formats are registered through `RoutedExtractor` in
`lifescribe.ingest.registry_default`. A routed extractor still satisfies
the existing `Extractor` protocol: it exposes `mimes`, `NAME`,
`VERSION`, and `extract(path)`.

When adding a new conversion engine, wrap it as a normal extractor and
add it to a route rather than changing `FileDropConnector`. This keeps
connector collection, dedupe, vault writes, and ingestion logs
unchanged.
