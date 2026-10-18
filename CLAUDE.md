## Branch rules
Name new branches the following way:
* Bug fix: bug/<short description of bug-with-issue-id-at-the-beginning>; e.g. bug/issue66-firefox-163-crash
* New feature feature/<description of feature>; e.g. feature/predictive-algorithm-tweak-2
Also if merging several features to master - we will want an integration branch with a version #; e.g.
* Integration branch: integration/v1.0.0

## Ensure always updated
Before starting work:
* Ensure you are always pulling latest version from origin (GitHub).
* Always check if origin/master has updates and merge them into your branch. If conflicts, them deal with them right away, but d>
* Make sure your local branch is up to date with origin.

## Performance & Optimization
* Algorithm selection
   * complexity choice - aim to avoid anything above O(n*log(n)) - unless necessary.
Of course in case the data source is very small then O(n^2) or worse are acceptable.
   * Memory vs CPU choice - Prefer using a little more memory than CPU, if performance gains are greater.
   * For very CPU intensive algorithms that actually slow down the app - multi threaded is encouraged, if possible.
   * For algorithms that need to run quickly and are easily parralelizable, multi threaded is encouraged.
   * For algorithms that need to run for a very long time and use the entire CPU, then do not use all cores and prefer a lower p>
* Optimize for slower CPU's - ensure older (20+ years old) CPU's (e.g. Pentium 4) can run this application comfortably.
* Global Memory usage: we want this application to be as lean as possible. Use least external dependencies, avoid large librarie>
   * External libraries are of course encouraged - we do not want to reinvent the wheel. However we need to balance between comp>
   * A counter example is using a massive library for just 1 or 2 simple functionalities - we simply do not want that.

