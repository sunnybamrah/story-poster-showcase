export const family = {
  parentLabel: 'Dee',
  familyContext: "Pip's grandad moved in with us in September. Pip shares a room with his little brother now. Pip gets loud when plans change. Soccer tryouts are next week.",
  hero: {
    nickname: 'Pip', name: 'Pip', age: 10, pronouns: 'he/him', species: 'human',
    loves: ['drawing comics', 'the dog Biscuit', 'soccer'],
    lookChips: ['human boy with short dark hair', 'round glasses'],
    lockedOutfit: ['green hoodie with a yellow lightning patch', 'red high top sneakers', 'blue sketchbook under one arm'],
    heroPicturePath: '',
  }, pastKits: [],
};
export const sentences = [
  "Pip slammed the door after school and won't say what happened, just that everyone is annoying.",
  "Pip says he's going to mess up tryouts and wants to quit before they even start.",
];
export const oldFact = 'Soccer tryouts are next week';
export const newFact = 'Soccer tryouts were moved to November';
export const deletedFact = 'Pip shares a room with his little brother now.';
export const savedKit = (changes = {}) => ({ date: '2026-10-14', chapterNumber: 1, moveId: 'name-it-exactly', triedMove: 'yes', didItHelp: 'yes', adventureLine: '', world: 'comic strip', colourSet: 'warm', ...changes });
