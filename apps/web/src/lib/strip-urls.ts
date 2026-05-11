/**
 * Web-side re-export of the shared text-clean module. Lives at this path
 * because the rest of the app already imports from `'../../lib/strip-urls'`
 * and migrating every call site to `@ch/text-clean` directly is busy work.
 *
 * The canonical source of these helpers is `packages/text-clean/src/index.ts`,
 * which the API workers also pull from so cleanup logic stays in lockstep
 * between write-time (classify-title) and display-time (this app).
 */
export {
  stripUrlsFromText,
  stripUrlsFromHtml,
  stripCaptionParagraphs,
  stripSpamParagraphs,
  stripSpamLines,
  stripTitleArtifacts,
  stripLLMTails,
  displayTitle,
  cleanTagList,
  isJunkTag,
  bodyDuplicatesTitle,
  looksLikeCaption,
} from '@ch/text-clean';
