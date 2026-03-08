'use strict';

function toSingleLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function yamlQuote(value) {
  return JSON.stringify(value);
}

function extractFrontmatterAndBody(content) {
  if (!content.startsWith('---')) {
    return { frontmatter: null, body: content };
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: null, body: content };
  }

  return {
    frontmatter: content.substring(3, endIndex).trim(),
    body: content.substring(endIndex + 3),
  };
}

function extractFrontmatterField(frontmatter, fieldName) {
  const regex = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const match = frontmatter.match(regex);
  if (!match) return null;
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function applyRuntimePathTokens(content, { pathPrefix, homePathPrefix, dirName }) {
  let converted = content;

  converted = converted.replace(/__GSD_PATH__/g, pathPrefix);
  converted = converted.replace(/__GSD_HOME_PATH__/g, homePathPrefix);
  converted = converted.replace(/__GSD_LOCAL_PATH__/g, `./${dirName}/`);
  converted = converted.replace(/__GSD_DIR__/g, dirName);

  // Backward-compatible handling for legacy source files while migration is in flight.
  converted = converted.replace(/~\/\.claude\//g, pathPrefix);
  converted = converted.replace(/\$HOME\/\.claude\//g, homePathPrefix);
  converted = converted.replace(/\.\/\.claude\//g, `./${dirName}/`);

  return converted;
}

module.exports = {
  toSingleLine,
  yamlQuote,
  extractFrontmatterAndBody,
  extractFrontmatterField,
  applyRuntimePathTokens,
};
