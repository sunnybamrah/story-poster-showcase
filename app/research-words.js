// Explain source words without changing a study's finding, dates or saved record.
const words = [
  ['naming', /\baffect label(?:ing|ling)\b/i, 'Naming feelings means putting feelings into words.'],
  ['feelings', /\bemotion differentiation\b/i, 'Telling feelings apart means noticing how one feeling differs from another.'],
  ['turning', /\bmental rotation(?: training)?\b/i, 'Mental rotation means picturing how a shape looks after a turn.'],
  ['comparison', /\bactive literacy control group\b/i, 'An active literacy control group is a group doing reading practice, to compare with another group.'],
  ['comparison', /\bcontrol group\b/i, 'A control group is a group used to compare results.'],
  ['chance', /\brandomi[sz]ed(?: controlled)?(?: trial)?\b/i, 'Randomized means chance picks the groups.'],
  ['answers', /\bself[- ]report(?:ed|s)?\b/i, 'Self-report means people give their own answers about how they feel or what they do.'],
  ['combined', /\bmeta[- ]analys(?:is|es)\b/i, 'Meta-analysis means putting results from several studies together.'],
  ['link', /\bcorrelat\w*/i, 'Correlation means a link. A link does not prove that one thing caused another.'],
  ['link', /\bassociation\b/i, 'Association means a link. A link does not prove that one thing caused another.'],
  ['summary', /\babstract\b/i, 'An abstract is a short summary of a study.'],
  ['body', /\bphysiological\b/i, 'Physiological means to do with the body, such as heartbeat.'],
  ['brain', /\bamygdala|\bprefrontal cortex\b/i, 'These words name a part of the brain.'],
  ['quick', /\bimmediate relief\b/i, 'Immediate relief means feeling better right away.'],
  ['activity', /\bintervention\b/i, 'An intervention is the activity or help being tested.'],
  ['new-place', /\b(?:learning|near|far) transfer\b|\btransfer of (?:learning|skills?)\b/i, 'Learning transfer means using what was learned in a different task or place.'],
  ['strength', /\bintensity\b/i, 'Intensity means how strong something is.'],
  ['growing', /\badolescents?\b/i, 'Adolescents are young people growing from children into adults.'],
  ['together', /\bcollaboration\b/i, 'Collaboration means working together.'],
  ['wanting', /\bmotivation\b/i, 'Motivation means what makes someone want to do something.'],
  ['feedback', /\bfeedback\b/i, 'Feedback means information about how you did.'],
  ['strategy', /\bstrategy questions\b/i, 'Strategy questions ask about a way to solve a problem.'],
  ['mixed-practice', /\bmixed problem practice\b/i, 'Mixed problem practice means practising different kinds of problems together.'],
  ['grouped-practice', /\bpractice grouped by problem type\b/i, 'Practice grouped by problem type means doing one kind of problem before moving to another kind.'],
  ['support', /\bstrongly supported in school settings\b/i, 'This research rating is about support from school studies. It does not mean this home activity was tested.'],
];

export function researchWordHelp(text = '') {
  const seen = new Set();
  return words.flatMap(([key, pattern, explanation]) => {
    if (seen.has(key) || !pattern.test(text)) return [];
    seen.add(key); return [explanation];
  });
}
