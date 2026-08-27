import { readFile, rename, writeFile } from "node:fs/promises";
import { KEYWORD_TAXONOMY } from "../catalog-search.js";

const catalogFile = "data/le-hussard-links.json";

function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function names(value) {
  return value.split("|");
}

const focusGroups = [
  {
    authors: names("Agatha Christie|Arthur Conan Doyle|Georges Simenon|Maurice Leblanc|Gaston Leroux"),
    tags: ["policier", "enquête", "mystère"],
  },
  {
    authors: names("J. R. R. Tolkien|Robert E. Howard|Chrétien de Troyes|Tradition médiévale"),
    tags: ["fantasy", "aventure", "mythologie"],
  },
  {
    authors: names("Frank Herbert|Philip K. Dick|Ray Bradbury|René Barjavel|Jules Verne"),
    tags: ["science-fiction", "aventure", "imaginaire"],
  },
  {
    authors: names("George Orwell|Aldous Huxley|Anthony Burgess|Ayn Rand|Boualem Sansal|Sandra Newman|Laurent Obertone"),
    tags: ["dystopie", "politique", "société"],
  },
  {
    authors: names("Alexandre Dumas|Arturo Pérez-Reverte|Joseph Kessel|Jack London|Ernest Hemingway|Alain Gerbault|Henry Morton Stanley|Sylvain Tesson|Xénophon"),
    tags: ["aventure", "voyage", "héroïsme"],
  },
  {
    authors: names("Bram Stoker|Mary Shelley|H. P. Lovecraft|Gou Tanabe, H. P. Lovecraft|Patrick Süskind"),
    tags: ["fantastique", "horreur", "mystère"],
  },
  {
    authors: names("Fred|Paul Grimault, Jacques Prévert|René Goscinny et Jean-Jacques Sempé|Lewis Carroll|Hans Christian Andersen"),
    tags: ["jeunesse", "imaginaire", "aventure"],
  },
  {
    authors: names("Aristophane|Eschyle|Sophocle|Jean Anouilh|Pierre Corneille|Molière|Beaumarchais|Edmond Rostand|Alfred Jarry|Eugène Ionesco|Tennessee Williams|Jules Romains"),
    tags: ["théâtre", "drame", "scène"],
  },
  {
    authors: names("Arthur Rimbaud|Charles Baudelaire|Paul Éluard|Jacques Prévert|Lautréamont|Jean de La Fontaine|Louis Aragon"),
    tags: ["poésie", "lyrisme", "langue"],
  },
  {
    authors: names("Baruch Spinoza|Blaise Pascal|Emmanuel Kant|Épictète|Friedrich Nietzsche|Henri Bergson|Héraclite|Marc Aurèle|Saint Augustin|Alain|Emil Cioran|Khalil Gibran"),
    tags: ["philosophie", "sagesse", "idées"],
  },
  {
    authors: names("Alexis de Tocqueville|Carl Schmitt|Carl von Clausewitz|Étienne de La Boétie|Friedrich Hayek|Gustave Le Bon|Henry David Thoreau|Jean-Jacques Rousseau|Julius Evola|Michel Clouscard|Michel Foucault|Montesquieu|Nicolas Machiavel|Philippe Muray|Raymond Aron|René Girard|Walter Benjamin|Alain Finkielkraut|Étienne Le Reun"),
    tags: ["essai", "politique", "société"],
  },
  {
    authors: names("Fernand Braudel|Georges Duby|Jean de Joinville|Marc Bloch|Jeremy Baneton"),
    tags: ["histoire", "essai", "société"],
  },
  {
    authors: names("Alexandre Soljenitsyne|Erich Maria Remarque|Ernst Jünger|Ernst von Salomon|Henri Barbusse|Maurice Genevoix|Pierre Lemaitre|Romain Gary"),
    tags: ["guerre", "histoire", "mémoire"],
  },
  {
    authors: names("François-René de Chateaubriand|Jean-Jacques Rousseau|Marcel Pagnol|Marcel Proust|Raymond Aron|Evguénia Iaroslavskaïa-Markon|Michel Audiard|Stephen King|Vanessa Springora|Jean-René Huguenin"),
    tags: ["mémoires", "autobiographie", "témoignage"],
  },
  {
    authors: names("Anonyme|Dante Alighieri|Hésiode|Homère|Collectif"),
    tags: ["mythologie", "épopée", "spiritualité"],
  },
  {
    authors: names("Curzio Malaparte|André Malraux|Charles Péguy|Georges Bernanos|Jean Raspail|Maurice Barrès|François Sureau|Renaud Camus"),
    tags: ["politique", "histoire", "société"],
  },
  {
    authors: names("Dino Buzzati|Franz Kafka|Jorge Luis Borges|Italo Calvino|Nicolas Gogol"),
    tags: ["fantastique", "absurde", "imaginaire"],
  },
  {
    authors: names("Albert Camus|Hermann Hesse|Joris-Karl Huysmans|Yukio Mishima|Georges Bernanos|Léon Bloy"),
    tags: ["roman", "philosophie", "spiritualité"],
  },
  {
    authors: names("Honoré de Balzac|Émile Zola|Gustave Flaubert|Guy de Maupassant|Stendhal|George Sand|Colette|Rétif de la Bretonne"),
    tags: ["roman", "société", "réalisme"],
  },
  {
    authors: names("Fiodor Dostoïevski|Léon Tolstoï|Nicolas Gogol|Ivan Tourgueniev"),
    tags: ["roman", "psychologie", "société"],
  },
  {
    authors: names("Charlotte Brontë|Emily Brontë|Jane Austen|Alfred de Musset|Albert Cohen|Gabriele D'Annunzio|Stefan Zweig"),
    tags: ["roman", "amour", "psychologie"],
  },
  {
    authors: names("Ahmadou Kourouma|Alain Mabanckou|David Diop|Mohamed Mbougar Sarr|Yambo Ouologuem|Karen Blixen"),
    tags: ["afrique", "roman", "histoire"],
  },
  {
    authors: names("F. Scott Fitzgerald|Bret Easton Ellis|John Steinbeck|Philip Roth|William Faulkner|William Golding"),
    tags: ["roman", "société", "psychologie"],
  },
  {
    authors: names("Émile Ajar|Albertine Sarrazin|Aurélien Bellanger|Hervé Bazin|Jean Giono|Jean-René Huguenin|Louis Calaferte|Marguerite Yourcenar|Patrick Modiano|Patrice Jean|Roger Nimier"),
    tags: ["roman", "société", "psychologie"],
  },
  {
    authors: names("François Rabelais|Miguel de Cervantes|Voltaire|Anatole France|Pierre Desproges"),
    tags: ["satire", "humour", "société"],
  },
  {
    authors: names("Marquis de Sade|Louis-Ferdinand Céline|Henry de Montherlant|Robert Musil|Johann Wolfgang von Goethe"),
    tags: ["roman", "transgression", "psychologie"],
  },
  {
    authors: names("Giuseppe Tomasi di Lampedusa|Umberto Eco|Marcel Proust|Marguerite Yourcenar"),
    tags: ["roman historique", "mémoire", "société"],
  },
  {
    authors: names("Roland Barthes|Stephen King"),
    tags: ["écriture", "littérature", "essai"],
  },
];

const countryGroups = [
  { authors: names("Agatha Christie|Aldous Huxley|Anthony Burgess|Arthur Conan Doyle|Bram Stoker|Charlotte Brontë|Emily Brontë|George Orwell|J. R. R. Tolkien|Lewis Carroll|Mary Shelley|Robert Musil|William Golding"), tag: "britannique" },
  { authors: names("Ayn Rand|Bret Easton Ellis|Ernest Hemingway|F. Scott Fitzgerald|Frank Herbert|H. P. Lovecraft|Gou Tanabe, H. P. Lovecraft|Henry David Thoreau|Jack London|John Steinbeck|Philip K. Dick|Philip Roth|Ray Bradbury|Robert E. Howard|Sandra Newman|Stephen King|Tennessee Williams|William Faulkner"), tag: "américaine" },
  { authors: names("Alexandre Soljenitsyne|Fiodor Dostoïevski|Léon Tolstoï|Nicolas Gogol|Evguénia Iaroslavskaïa-Markon"), tag: "russe" },
  { authors: names("Dino Buzzati|Dante Alighieri|Gabriele D'Annunzio|Giuseppe Tomasi di Lampedusa|Italo Calvino|Julius Evola|Umberto Eco"), tag: "italienne" },
  { authors: names("Baruch Spinoza|Friedrich Hayek|Friedrich Nietzsche|Franz Kafka|Hermann Hesse|Johann Wolfgang von Goethe|Joris-Karl Huysmans|Robert Musil|Stefan Zweig|Walter Benjamin"), tag: "européenne" },
  { authors: names("Ahmadou Kourouma|Alain Mabanckou|Boualem Sansal|David Diop|Mohamed Mbougar Sarr|Yambo Ouologuem"), tag: "francophone" },
  { authors: names("Aristophane|Eschyle|Épictète|Héraclite|Hésiode|Homère|Sophocle|Xénophon"), tag: "antiquité" },
  { authors: names("Arturo Pérez-Reverte|Miguel de Cervantes"), tag: "espagnole" },
  { authors: names("Jorge Luis Borges"), tag: "argentine" },
  { authors: names("Yukio Mishima"), tag: "japonaise" },
];

const eraGroups = [
  { authors: names("Aristophane|Eschyle|Héraclite|Hésiode|Homère|Sophocle|Xénophon|Épictète|Marc Aurèle|Saint Augustin|Anonyme"), tag: "antiquité" },
  { authors: names("Chrétien de Troyes|Dante Alighieri|Jean de Joinville|Tradition médiévale"), tag: "moyen âge" },
  { authors: names("Beaumarchais|Blaise Pascal|François Rabelais|Jean de La Fontaine|Marquis de Sade|Miguel de Cervantes|Molière|Montesquieu|Nicolas Machiavel|Rétif de la Bretonne|Spinoza|Voltaire"), tag: "classique" },
  { authors: names("Alexandre Dumas|Alexis de Tocqueville|Alfred de Musset|Arthur Rimbaud|Bram Stoker|Charles Baudelaire|Charlotte Brontë|Émile Zola|Emily Brontë|Fiodor Dostoïevski|François-René de Chateaubriand|Gustave Flaubert|Guy de Maupassant|Honoré de Balzac|Joris-Karl Huysmans|Jules Verne|Léon Tolstoï|Lewis Carroll|Mary Shelley|Stendhal"), tag: "xixe siècle" },
];

function findGroupTag(author, groups, fallback) {
  return groups.find((group) => group.authors.includes(author))?.tag || fallback;
}

function getFocusTags(author) {
  return focusGroups.find((group) => group.authors.includes(author))?.tags || ["roman", "société", "littérature"];
}

const titleRules = [
  { pattern: /memoires d.hadrien/, tags: ["roman historique", "histoire", "antiquité"] },
  { pattern: /memoires de porc-epic/, tags: ["roman", "afrique", "fantastique"] },
  { pattern: /dune/, tags: ["science-fiction", "space opera", "politique"] },
  { pattern: /seigneur des anneaux|hobbit|silmarillion|beren|hurin/, tags: ["fantasy", "aventure", "quête"] },
  { pattern: /1984|2084|meilleur des mondes|ferme des animaux|fahrenheit|ravage|hymne|greve/, tags: ["dystopie", "politique", "société"] },
  { pattern: /monte.?cristo|mousquetaires|vingt ans apres|reine margot|chouans|capitaine alatriste/, tags: ["aventure", "roman historique", "cape et épée"] },
  { pattern: /iliade|odyssee|gilgamesh|divine comedie|anabase/, tags: ["épopée", "aventure", "mythologie"] },
  { pattern: /guerre et paix|orages d.acier|ouest rien de nouveau|goulag|ivan denissovitch|ceux de 14|mort de pres/, tags: ["guerre", "histoire", "mémoire"] },
  { pattern: /crime|orient express|signe des quatre|etude en rouge|arsene lupin|chien jaune/, tags: ["policier", "enquête", "mystère"] },
  { pattern: /dracula|frankenstein|couleur tombee du ciel|parfum/, tags: ["fantastique", "horreur", "mystère"] },
  { pattern: /cinq semaines|tour du monde|vingt mille lieues|ile mysterieuse|centre de la terre|terre a la lune/, tags: ["aventure", "exploration", "science-fiction"] },
  { pattern: /petit prince/, tags: ["jeunesse", "imaginaire", "philosophie"] },
  { pattern: /nom de la rose/, tags: ["policier", "roman historique", "moyen âge"] },
  { pattern: /servitude|democratie|politique|capitalisme|communisme|totalitarisme|prince|contrat social|esprit des lois/, tags: ["politique", "essai", "société"] },
  { pattern: /ethique|zarathoustra|morale|mythe de sisyphe|homme revolte|pensees|manuel|syllogismes/, tags: ["philosophie", "sagesse", "idées"] },
  { pattern: /memoires|confessions|journal|ecriture/, tags: ["mémoires", "autobiographie", "témoignage"] },
  { pattern: /fleurs du mal|poesies|contemplations|chants de maldoror|yeux d.elsa|creve.?coeur|paroles/, tags: ["poésie", "lyrisme", "langue"] },
  { pattern: /antigone|ubu|cyrano|hernani|cid|lysistrata|rhinoceros|figaro|faust/, tags: ["théâtre", "drame", "scène"] },
];

function inferKeywords(link) {
  const title = normalize(link.label);
  const titleTags = titleRules.find((rule) => rule.pattern.test(title))?.tags || [];
  const country = findGroupTag(link.author, countryGroups, "française");
  const era = findGroupTag(link.author, eraGroups, "xxe siècle");
  const candidates = [...titleTags, ...getFocusTags(link.author), country, era, "littérature"];

  return [...new Set(candidates)].slice(0, 5);
}

const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
const keywordsByBook = new Map();

for (const video of catalog.videos) {
  for (const link of video.links) {
    if (link.type !== "amazon") {
      continue;
    }

    const bookKey = normalize(`${link.label} ${link.author || ""}`.trim());
    if (!keywordsByBook.has(bookKey)) {
      keywordsByBook.set(bookKey, inferKeywords(link));
    }
    link.keywords = keywordsByBook.get(bookKey);
  }
}

const invalid = [...keywordsByBook.entries()].filter(([, keywords]) => keywords.length !== 5);
if (invalid.length > 0) {
  throw new Error(`Could not infer 5 keywords for ${invalid.length} books.`);
}

const unknown = [...new Set([...keywordsByBook.values()].flat())].filter(
  (keyword) => !KEYWORD_TAXONOMY.has(keyword),
);
if (unknown.length > 0) {
  throw new Error(`Unknown keywords: ${unknown.join(", ")}`);
}

await writeFile(`${catalogFile}.tmp`, `${JSON.stringify(catalog, null, 2)}\n`);
await rename(`${catalogFile}.tmp`, catalogFile);
console.log(`Added 5 keywords to ${keywordsByBook.size} unique books.`);
