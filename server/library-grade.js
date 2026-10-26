// An explicit U.S. K to 12 choice, never a conversion from age or another system.
export const isSchoolGrade = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && value.system === 'US' && Number.isInteger(value.level) && value.level >= 0 && value.level <= 12
  && Object.keys(value).sort().join() === 'level,system';
export function optionalSchoolGrade(value) {
  if (value == null) return undefined;
  if (!isSchoolGrade(value)) throw new Error('Choose a U.S. school grade, or leave it blank.');
  return { system: value.system, level: value.level };
}
