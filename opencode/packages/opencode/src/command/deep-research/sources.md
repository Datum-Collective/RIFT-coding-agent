# Source lenses

Each angle in `plan.md` is tagged with one or more lenses. Use the lens's sources and query moves. Every source below works with plain web fetch, so the dig runs even when no search tool is available; use a search tool too when you have one.

Before searching, write 5-10 query variations: the field's own terms, the newcomer's terms, the names of key authors and systems, and the failure words (`limitation`, `fails`, `negative result`, `does not replicate`).

## papers

- **OpenAlex** `https://api.openalex.org/works?search=<q>&filter=from_publication_date:<YYYY-MM-DD>&sort=cited_by_count:desc&per-page=25`. Use `cited_by_count` for the core and `sort=publication_date:desc` for the frontier. `https://api.openalex.org/works?filter=cites:<openalex-id>` lists who cites a work: follow it forward from a seminal paper.
- **Semantic Scholar** `https://api.semanticscholar.org/graph/v1/paper/search?query=<q>&fields=title,year,citationCount,externalIds,url,abstract,tldr&limit=20`. Rate-limited: space requests out.
- **arXiv** `http://export.arxiv.org/api/query?search_query=all:<q>&sortBy=submittedDate&sortOrder=descending&max_results=25`. The frontier lives here. Read the abstract page `https://arxiv.org/abs/<id>` and the HTML full text `https://arxiv.org/html/<id>` when it exists.
- **Hugging Face papers** `https://huggingface.co/papers?q=<q>` for ML papers practitioners are discussing.

Read past the abstract for any paper you cite for a specific number or method detail. Record the arXiv id as `eprint` and the DOI as `doi` in BibTeX.

## code

- **GitHub** `https://api.github.com/search/repositories?q=<q>&sort=stars` and `https://api.github.com/search/issues?q=<q>+is:issue`. Issues are where people report that a method breaks in practice.
- **Papers with Code** links for reference implementations and benchmark tables.

Cite a repo with `@software` and its URL. A reproduction attempt in an issue thread is evidence; cite the issue URL.

## practice

- **Hacker News** `https://hn.algolia.com/api/v1/search?query=<q>&tags=story` and `tags=comment` for practitioner critique.
- **Reddit** `https://www.reddit.com/search.json?q=<q>&sort=top&t=year`, or a subreddit's `/search.json?restrict_sr=1&q=<q>`.
- Engineering blogs, official docs and talks from the teams that ship the thing.

Practitioner sources are good evidence for what breaks and what people use, and weak evidence for why. Say which in the claim.

## adjacent

Search the same problem under another field's vocabulary: the statistician's, the economist's, the biologist's, the systems engineer's. Ask "who else has to solve this?" and search their venues. Bridges come from here.

## critics

Search `<topic> critique`, `<topic> limitations`, `<topic> replication`, `<topic> benchmark contamination`, and the names of the core papers plus `fails` or `revisited`. Read the rebuttals too.
