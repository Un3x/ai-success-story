module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "articles/*.md": "post" });

  eleventyConfig.addCollection("articles", (collectionApi) =>
    collectionApi
      .getFilteredByGlob("articles/*.md")
      .sort((a, b) => b.date - a.date),
  );

  eleventyConfig.ignores.add("README.md");
  eleventyConfig.ignores.add("CLAUDE.md");
  eleventyConfig.ignores.add("vision.md");
  eleventyConfig.ignores.add("state.md");
  eleventyConfig.ignores.add("lifecycle.md");
  eleventyConfig.ignores.add("format-spec.md");
  eleventyConfig.ignores.add("setup.md");
  eleventyConfig.ignores.add("MEMORY");

  return {
    dir: {
      input: ".",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["md", "njk", "html"],
  };
};
