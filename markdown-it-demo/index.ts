import { join } from "node:path";
import { writeFileSync } from "node:fs";

import MarkdownIt from "markdown-it";

import markdownItBlurest from "@fuuck/markdown-it-blurest";

const md = new MarkdownIt({
  html: true,
  xhtmlOut: true,
  breaks: false,
  typographer: true,
}).use(markdownItBlurest, {
  databasePath: join(__dirname, "db.sqlite3"),
  projectRoot: __dirname,
});

const document = `
# The ginkgo tree

(Ginkgo biloba) is one of the world's most remarkable and ancient tree species, often referred to as a "living fossil" due to its evolutionary history spanning over 270 million years. Native to China, this deciduous conifer is the sole surviving member of the Ginkgoaceae family, making it truly unique in the plant kingdom.

![The ginkgo tree](./demo.jpg)

Ginkgo trees are easily recognizable by their distinctive fan-shaped leaves, which turn a brilliant golden-yellow color in autumn before falling. These trees are dioecious, meaning individual trees are either male or female. Female trees produce small, plum-like seeds with a fleshy outer layer that, while nutritious, emits a strong, unpleasant odor when it decays. For this reason, male trees are typically preferred for urban landscaping.

![Yellw ginkgo leaf](./demo1.jpg =300x)

Known for their exceptional longevity and resilience, ginkgo trees can live for over 1,000 years and withstand harsh environmental conditions, including pollution, drought, and extreme temperatures. They have no known natural pests or diseases, making them popular choices for city streets and parks worldwide. The species gained particular recognition for its remarkable survival after the atomic bombing of Hiroshima in 1945, where several ginkgo trees near the blast site survived and continue to thrive today.

Beyond their ornamental value, ginkgo trees have significant cultural and medicinal importance. In traditional Chinese medicine, ginkgo leaves and seeds have been used for centuries to treat various ailments. Modern research has focused on ginkgo leaf extracts as potential treatments for memory enhancement and circulatory problems, though scientific evidence remains mixed regarding their effectiveness.`;

writeFileSync(".output.html", md.render(document));
