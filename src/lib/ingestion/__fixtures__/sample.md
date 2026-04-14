# Locus attachment extractor fixture

This markdown file is read verbatim by `extractPlainText` and
`extractByMime('text/markdown', …)` in the unit tests. The distinctive
phrase **hello-extractor-from-md** lets the test assert the expected
content round-tripped through the extractor without ambiguity.
