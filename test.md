## Context

Insta Quote AI builds an AI-powered quoting platform for construction and trade businesses in New Zealand and Australia. Customers upload building plans and other documents, and the software reads them to produce measurements and quotes without manual takeoff work.

The engineering problem here is not "write features." It is two things.

First, reading messy real-world documents and knowing what you cannot know. Real drawings and paperwork are dirty. A confidently wrong number is worse than an explicit refusal, and every extracted quantity needs to carry evidence for where it came from.

Second, making a correct value survive every layer until the person using the product actually sees it. Getting the right answer inside an engine is not the same as the right answer reaching the screen. A result that is correct internally but gets converted into a generic "something went wrong" message on the way out has still failed the person using it.

Whoever joins in this role will work closely with both of these, day to day, in production. This task is a small, safe-to-share slice of exactly that kind of problem.

## The task

Build two parts. Budget roughly 5 hours across both.

**Part A (about 3 hours).** A service that takes a PDF and returns JSON: the line items it could extract, each carrying evidence (the page number and the exact source text it came from), plus a separate list of anything it refused to extract and why.

**The hard rule:** never output a number you cannot point to a source for. Refusing to extract something is a correct result. Guessing is not.

**Part B (about 2 hours).** A small web page that uploads a file to Part A and displays the result, including the refusals. Refusals need to be legible to someone who isn't technical. Collapsing a refusal into "an error occurred" fails this part; it is deliberately the same failure mode a real bug in this product hit recently.

## What's provided

A set of six sample PDFs (invoices, packing lists and delivery dockets, not real customer documents), sent to you when you're ready to start (see Timeline). Some are clean; some have the kind of problems real documents have.

No starter repository. Set up the project from scratch, in whichever stack fits best.

## Requirements

1. Stack is your choice. The team currently works in TypeScript, Next.js, tRPC, React Native, Expo, Supabase and Vercel, and matching it makes the work easier for us to review, but it isn't mandatory.
2. Every extracted number must be traceable to a page and the source text it came from.
3. When a document is ambiguous or contradicts itself, surface that explicitly rather than quietly picking an answer.
4. Loading and error states in Part B should show the real reason something failed or was refused, not a generic message.
5. Using AI coding agents (Claude Code, Codex, Cursor, or similar) is expected. We use them daily ourselves. What matters is that you understand and can explain what was built, not that every line was typed by hand.
6. A couple of tests covering the refusal rules specifically. Broad coverage elsewhere is welcome but not the point.

## What we're evaluating

1. Whether you refuse in the right places, and never invent a number to fill a gap.
2. Whether problems in part of a file are contained, or take down the rest of it.
3. Whether every number in your output can be traced back to a page and source text.
4. Whether a refusal actually reaches the person using Part B, in plain language, rather than getting swallowed into a generic error.
5. Code that's readable and has some test coverage of the refusal logic.
6. Whether your README is honest about where you're uncertain, rather than describing everything as working.

## How to submit

1. Push your work to a repository with visible commit history. Not a zip file.
2. Include a README answering three questions: what was the hardest decision and why you chose that way; where you're not confident; and what you'd do with three more days.
3. Send the repo link to Luke via nguyenvanlocdhqt@gmail.com.

## Timeline

You have 24 hours from when the sample files are sent to you. 

Expected effort is around 5 hours. That's stated plainly so someone who spends 5 hours isn't compared unfavourably against someone who spends 20. A smaller, finished submission beats a larger, unfinished one.
