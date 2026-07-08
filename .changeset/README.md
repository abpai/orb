# Changesets

This project uses Changesets to prepare and publish npm releases.

For user-facing changes, run `bun run changeset` and choose the SemVer bump. When
the change lands on `main`, the release workflow opens or updates a version PR.
Merging that version PR publishes the package and creates the npm/git release
metadata through the release workflow.
