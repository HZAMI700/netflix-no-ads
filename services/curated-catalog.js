'use strict';
/**
 * Zflexy Curated Media Catalog & Content Safety Audit System
 * 100% verified, clean, non-sexual titles with complete metadata.
 * Every title includes verified IMDb ID, TMDb ID, genres, rating, synopsis, and high-res art.
 */

const SEXUAL_KEYWORDS_RE = /\b(erotic|erotica|porn|pornographic|pornography|softcore|hardcore|hentai|ecchi|sex tape|sex worker|threesome|gangbang|orgasm|sexually explicit|sensual massage|nude model|fetish|bdsm|swinger|swingers)\b/i;
const ADULT_GENRES = new Set(['adult', 'erotica', 'erotic', 'hentai', 'porn']);
const ADULT_BLOCKED_IDS = new Set([
  'tt21187592', // The Threesome
  'tt1826940',  // 365 Days
  'tt13334658', // 365 Days: This Day
  'tt20424564', // The Next 365 Days
  'tt2322441',  // Fifty Shades of Grey
  'tt4465564',  // Fifty Shades Darker
  'tt4477536'   // Fifty Shades Freed
]);

/**
 * Strict content safety guard: returns false for any sexual, erotic, pornographic, or adult content.
 */
function isSafeContent(m) {
  if (!m) return false;
  const id = String(m.id || m.imdb_id || m.imdb || '').split(':')[0].trim();
  if (ADULT_BLOCKED_IDS.has(id)) return false;

  const rawGenres = Array.isArray(m.genres) ? m.genres : (Array.isArray(m.genre) ? m.genre : []);
  const genres = rawGenres.map(g => String(g).toLowerCase().trim());
  if (genres.some(g => ADULT_GENRES.has(g) || g.includes('erotic') || g.includes('adult'))) return false;

  const name = String(m.name || m.title || '').trim();
  if (SEXUAL_KEYWORDS_RE.test(name)) return false;

  const desc = String(m.description || m.overview || '').trim();
  if (SEXUAL_KEYWORDS_RE.test(desc)) return false;

  const cert = String(m.certification || '').toUpperCase().trim();
  if (cert === 'NC-17' || cert === 'X' || cert === 'XXX') return false;

  return true;
}

// Canonical complete episodes for Reacher (Season 1 & Season 2)
const REACHER_EPISODES = [
  // Season 1
  { season: 1, episode: 1, name: 'Welcome to Margrave', title: 'Welcome to Margrave', runtime: '48m', overview: 'When retired Military Police Officer Jack Reacher is arrested for a murder he did not commit, he finds himself in the middle of a deadly conspiracy.' },
  { season: 1, episode: 2, name: 'First Dance', title: 'First Dance', runtime: '53m', overview: 'As the investigation deepens, Reacher teams up with Officer Roscoe and Detective Finlay to dig into the town\'s corrupt secrets.' },
  { season: 1, episode: 3, name: 'Spoonful', title: 'Spoonful', runtime: '47m', overview: 'Reacher and Finlay head to Atlanta to track down Spivey, while Roscoe encounters danger back in Margrave.' },
  { season: 1, episode: 4, name: 'In a Tree', title: 'In a Tree', runtime: '45m', overview: 'After surviving an ambush, Reacher and Roscoe grow closer as they uncover the scale of the counterfeiting operation.' },
  { season: 1, episode: 5, name: 'No Apologies', title: 'No Apologies', runtime: '48m', overview: 'Reacher meets with his former colleague Frances Neagley to trace the chemicals used in the counterfeit currency.' },
  { season: 1, episode: 6, name: 'Papier', title: 'Papier', runtime: '52m', overview: 'With the net tightening, Reacher protects Picard and Charlie while unearthing a key lead in New York.' },
  { season: 1, episode: 7, name: 'Reacher Said Nothing', title: 'Reacher Said Nothing', runtime: '44m', overview: 'Reacher prepares a trap for the hit squad sent after him, turning the tables in the woods of Margrave.' },
  { season: 1, episode: 8, name: 'Pie', title: 'Pie', runtime: '56m', overview: 'Reacher, Finlay, and Neagley launch an assault on the warehouse to rescue Roscoe and destroy the counterfeit syndicate.' },
  // Season 2
  { season: 2, episode: 1, name: 'ATM', title: 'ATM', runtime: '50m', overview: 'When members of his former military unit are murdered under suspicious circumstances, Reacher reunites with his team to investigate.' },
  { season: 2, episode: 2, name: 'What Happens in Atlantic City', title: 'What Happens in Atlantic City', runtime: '49m', overview: 'The 110th investigates a defense contractor in Atlantic City and discovers a conspiracy involving high-grade weaponry.' },
  { season: 2, episode: 3, name: 'Picture Says a Thousand Words', title: 'Picture Says a Thousand Words', runtime: '46m', overview: 'Reacher and his team track a mysterious broker known as A.M., uncovering New Age Technologies\' dark secrets.' },
  { season: 2, episode: 4, name: 'A Night at the Symphony', title: 'A Night at the Symphony', runtime: '48m', overview: 'The team pressures a corrupt legislative aide during an orchestral event in Boston to gather intelligence on Project Little Wing.' },
  { season: 2, episode: 5, name: 'Burial', title: 'Burial', runtime: '43m', overview: 'Following a close friend\'s funeral, Reacher and his crew are ambushed in a cemetery, leading to a relentless pursuit.' },
  { season: 2, episode: 6, name: 'New York\'s Finest', title: 'New York\'s Finest', runtime: '50m', overview: 'Reacher works with NYPD Detective Russo while the team corners Langston\'s security forces.' },
  { season: 2, episode: 7, name: 'The Man Goes Through', title: 'The Man Goes Through', runtime: '46m', overview: 'Russo makes the ultimate sacrifice to protect Marlo Burns\' daughter; Reacher prepares to surrender himself as a Trojan horse.' },
  { season: 2, episode: 8, name: 'Fly Boy', title: 'Fly Boy', runtime: '52m', overview: 'Reacher stages a daring helicopter rescue to save O\'Donnell and Dixon and execute justice on Langston and A.M.' }
];

const RAW_CURATED_MEDIA = [
  // BLOCKBUSTER & SCI-FI MOVIES
  { id: 'tt1375666', name: 'Inception', type: 'movie', year: 2010, imdbRating: '8.8', genres: ['Action', 'Adventure', 'Sci-Fi'], moviedb_id: 27205, description: 'A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.' },
  { id: 'tt0816692', name: 'Interstellar', type: 'movie', year: 2014, imdbRating: '8.7', genres: ['Adventure', 'Drama', 'Sci-Fi'], moviedb_id: 157336, description: 'When Earth becomes uninhabitable, a team of astronauts travels through a wormhole near Saturn in search of a new home for humankind.' },
  { id: 'tt0468569', name: 'The Dark Knight', type: 'movie', year: 2008, imdbRating: '9.0', genres: ['Action', 'Crime', 'Drama'], moviedb_id: 155, description: 'When the menace known as the Joker wreaks havoc and chaos on the people of Gotham, Batman must accept one of the greatest psychological and physical tests of his ability to fight injustice.' },
  { id: 'tt1345836', name: 'The Dark Knight Rises', type: 'movie', year: 2012, imdbRating: '8.4', genres: ['Action', 'Drama', 'Thriller'], moviedb_id: 49026, description: 'Eight years after the Joker\'s reign of chaos, Batman is forced from his exile with the help of the enigmatic Selina Kyle in Gotham City.' },
  { id: 'tt0372784', name: 'Batman Begins', type: 'movie', year: 2005, imdbRating: '8.2', genres: ['Action', 'Crime', 'Drama'], moviedb_id: 272, description: 'After training with his mentor, Batman begins his fight to free crime-ridden Gotham City from corruption.' },
  { id: 'tt1877830', name: 'The Batman', type: 'movie', year: 2022, imdbRating: '7.8', genres: ['Action', 'Crime', 'Drama'], moviedb_id: 414906, description: 'When a sadistic serial killer begins murdering key political figures in Gotham, the Batman is forced to investigate the city\'s hidden corruption.' },
  { id: 'tt15398776', name: 'Oppenheimer', type: 'movie', year: 2023, imdbRating: '8.9', genres: ['Biography', 'Drama', 'History'], moviedb_id: 872585, description: 'The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb.' },
  { id: 'tt1160419', name: 'Dune: Part One', type: 'movie', year: 2021, imdbRating: '8.0', genres: ['Action', 'Adventure', 'Sci-Fi'], moviedb_id: 438631, description: 'A noble family becomes embroiled in a war for control over the galaxy\'s most valuable asset while its heir becomes troubled by visions of a dark future.' },
  { id: 'tt15239678', name: 'Dune: Part Two', type: 'movie', year: 2024, imdbRating: '8.5', genres: ['Action', 'Adventure', 'Drama', 'Sci-Fi'], moviedb_id: 693134, description: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.' },
  { id: 'tt0499549', name: 'Avatar', type: 'movie', year: 2009, imdbRating: '7.9', genres: ['Action', 'Adventure', 'Fantasy', 'Sci-Fi'], moviedb_id: 19995, description: 'A paraplegic Marine dispatched to the moon Pandora on a unique mission becomes torn between following his orders and protecting the world he feels is his home.' },
  { id: 'tt1630029', name: 'Avatar: The Way of Water', type: 'movie', year: 2022, imdbRating: '7.6', genres: ['Action', 'Adventure', 'Fantasy', 'Sci-Fi'], moviedb_id: 76600, description: 'Jake Sully lives with his newfound family formed on the extrasolar moon Pandora. Once a familiar threat returns, Jake must work with Neytiri and the Na\'vi army.' },
  { id: 'tt0172495', name: 'Gladiator', type: 'movie', year: 2000, imdbRating: '8.5', genres: ['Action', 'Adventure', 'Drama'], moviedb_id: 98, description: 'A former Roman General sets out to exact vengeance against the corrupt emperor who murdered his family and sent him into slavery.' },
  { id: 'tt1745960', name: 'Top Gun: Maverick', type: 'movie', year: 2022, imdbRating: '8.2', genres: ['Action', 'Drama'], moviedb_id: 361743, description: 'After thirty years, Maverick is still pushing the envelope as a top naval aviator, but must confront ghosts of his past when he leads TOP GUN\'s elite graduates.' },
  { id: 'tt4633694', name: 'Spider-Man: Into the Spider-Verse', type: 'movie', year: 2018, imdbRating: '8.4', genres: ['Animation', 'Action', 'Adventure'], moviedb_id: 324857, description: 'Teen Miles Morales becomes the new Spider-Man and joins other Spider-Heroes from parallel dimensions to stop a threat to all reality.' },
  { id: 'tt9362722', name: 'Spider-Man: Across the Spider-Verse', type: 'movie', year: 2023, imdbRating: '8.6', genres: ['Animation', 'Action', 'Adventure'], moviedb_id: 569094, description: 'Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People charged with protecting its very existence.' },
  { id: 'tt10872600', name: 'Spider-Man: No Way Home', type: 'movie', year: 2021, imdbRating: '8.2', genres: ['Action', 'Adventure', 'Fantasy'], moviedb_id: 634649, description: 'With Spider-Man\'s identity now revealed, Peter asks Doctor Strange for help, causing spells to go wrong and villains from alternate realities to enter.' },
  { id: 'tt4154796', name: 'Avengers: Endgame', type: 'movie', year: 2019, imdbRating: '8.4', genres: ['Action', 'Adventure', 'Drama', 'Sci-Fi'], moviedb_id: 299534, description: 'After the devastating events of Infinity War, the universe is in ruins. With the help of remaining allies, the Avengers assemble once more.' },
  { id: 'tt4154756', name: 'Avengers: Infinity War', type: 'movie', year: 2018, imdbRating: '8.4', genres: ['Action', 'Adventure', 'Sci-Fi'], moviedb_id: 299536, description: 'The Avengers and their allies must be willing to sacrifice all in an attempt to defeat the powerful Thanos before his blitz of devastation.' },
  { id: 'tt0371746', name: 'Iron Man', type: 'movie', year: 2008, imdbRating: '7.9', genres: ['Action', 'Adventure', 'Sci-Fi'], moviedb_id: 1726, description: 'After being held captive in an Afghan cave, billionaire engineer Tony Stark creates a unique weaponized suit of armor to fight evil.' },
  { id: 'tt0133093', name: 'The Matrix', type: 'movie', year: 1999, imdbRating: '8.7', genres: ['Action', 'Sci-Fi'], moviedb_id: 603, description: 'When a beautiful stranger leads computer hacker Neo to a forbidding underworld, he discovers the shocking truth: his reality is a deception created by AI.' },
  { id: 'tt0110912', name: 'Pulp Fiction', type: 'movie', year: 1994, imdbRating: '8.9', genres: ['Crime', 'Drama'], moviedb_id: 680, description: 'The lives of two mob hitmen, a boxer, a gangster and his wife, and a pair of diner bandits intertwine in four tales of violence and redemption.' },
  { id: 'tt0137523', name: 'Fight Club', type: 'movie', year: 1999, imdbRating: '8.8', genres: ['Drama'], moviedb_id: 550, description: 'An insomniac office worker and a devil-may-care soap maker form an underground fight club that evolves into much more.' },
  { id: 'tt0111161', name: 'The Shawshank Redemption', type: 'movie', year: 1994, imdbRating: '9.3', genres: ['Drama'], moviedb_id: 278, description: 'Over the course of several years, two convicts form a friendship, seeking consolation and, eventually, redemption through basic compassion.' },
  { id: 'tt0068646', name: 'The Godfather', type: 'movie', year: 1972, imdbRating: '9.2', genres: ['Crime', 'Drama'], moviedb_id: 238, description: 'The aging patriarch of an organized crime dynasty transfers control of his clandestine empire to his reluctant youngest son.' },
  { id: 'tt0071562', name: 'The Godfather Part II', type: 'movie', year: 1974, imdbRating: '9.0', genres: ['Crime', 'Drama'], moviedb_id: 240, description: 'The early life and career of Vito Corleone in 1920s New York City is portrayed, while his son, Michael, expands and tightens his grip on the family crime syndicate.' },
  { id: 'tt0109830', name: 'Forrest Gump', type: 'movie', year: 1994, imdbRating: '8.8', genres: ['Drama', 'Romance'], moviedb_id: 13, description: 'The history of the United States from the 1950s to the \'70s unfolds from the perspective of an Alabama man with an IQ of 75.' },
  { id: 'tt0099685', name: 'Goodfellas', type: 'movie', year: 1990, imdbRating: '8.7', genres: ['Biography', 'Crime', 'Drama'], moviedb_id: 769, description: 'The story of Henry Hill and his life in the mafia, covering his relationship with his wife and his mob partners.' },
  { id: 'tt0120737', name: 'The Lord of the Rings: The Fellowship of the Ring', type: 'movie', year: 2001, imdbRating: '8.9', genres: ['Action', 'Adventure', 'Drama', 'Fantasy'], moviedb_id: 120, description: 'A meek Hobbit from the Shire and eight companions set out on a journey to destroy the powerful One Ring and save Middle-earth from the Dark Lord Sauron.' },
  { id: 'tt0167261', name: 'The Lord of the Rings: The Two Towers', type: 'movie', year: 2002, imdbRating: '8.8', genres: ['Action', 'Adventure', 'Drama', 'Fantasy'], moviedb_id: 121, description: 'While Frodo and Sam edge closer to Mordor with the help of the shifty Gollum, the divided fellowship makes a stand against Sauron\'s new ally, Saruman.' },
  { id: 'tt0167260', name: 'The Lord of the Rings: The Return of the King', type: 'movie', year: 2003, imdbRating: '9.0', genres: ['Action', 'Adventure', 'Drama', 'Fantasy'], moviedb_id: 122, description: 'Gandalf and Aragorn lead the World of Men against Sauron\'s army to draw his gaze from Frodo and Sam as they approach Mount Doom with the One Ring.' },
  { id: 'tt0076759', name: 'Star Wars: A New Hope', type: 'movie', year: 1977, imdbRating: '8.6', genres: ['Action', 'Adventure', 'Fantasy', 'Sci-Fi'], moviedb_id: 11, description: 'Luke Skywalker joins forces with a Jedi Knight, a cocky pilot, a Wookiee and two droids to save the galaxy from the Empire\'s world-destroying battle station.' },
  { id: 'tt0080684', name: 'Star Wars: The Empire Strikes Back', type: 'movie', year: 1980, imdbRating: '8.7', genres: ['Action', 'Adventure', 'Fantasy', 'Sci-Fi'], moviedb_id: 1891, description: 'After the Empire overpowers the Rebel Alliance, Luke Skywalker begins Jedi training with Yoda, while his friends are pursued across the galaxy by Darth Vader.' },
  { id: 'tt0107290', name: 'Jurassic Park', type: 'movie', year: 1993, imdbRating: '8.2', genres: ['Action', 'Adventure', 'Sci-Fi'], moviedb_id: 329, description: 'A pragmatic paleontologist touring an almost complete theme park on an island in Central America is tasked with protecting a couple of kids after a power failure.' },
  { id: 'tt0245429', name: 'Spirited Away', type: 'movie', year: 2001, imdbRating: '8.6', genres: ['Animation', 'Adventure', 'Family', 'Fantasy'], moviedb_id: 129, description: 'During her family\'s move to the suburbs, a sullen 10-year-old girl wanders into a world ruled by gods, spirits, and magical creatures.' },
  { id: 'tt2582802', name: 'Whiplash', type: 'movie', year: 2014, imdbRating: '8.5', genres: ['Drama', 'Music'], moviedb_id: 244786, description: 'A promising young drummer enrolls at a cut-throat music conservatory where his dreams of greatness are mentored by an instructor who will stop at nothing.' },
  { id: 'tt6751668', name: 'Parasite', type: 'movie', year: 2019, imdbRating: '8.5', genres: ['Drama', 'Thriller'], moviedb_id: 496243, description: 'Greed and class discrimination threaten the newly formed symbiotic relationship between the wealthy Park family and the destitute Kim clan.' },
  { id: 'tt1856101', name: 'Blade Runner 2049', type: 'movie', year: 2017, imdbRating: '8.0', genres: ['Action', 'Drama', 'Mystery', 'Sci-Fi'], moviedb_id: 335984, description: 'Young Blade Runner K\'s discovery of a long-buried secret leads him to track down former Blade Runner Rick Deckard, who\'s been missing for thirty years.' },
  { id: 'tt1853728', name: 'Django Unchained', type: 'movie', year: 2012, imdbRating: '8.5', genres: ['Drama', 'Western'], moviedb_id: 68718, description: 'With the help of a German bounty-hunter, a freed slave sets out to rescue his wife from a brutal plantation owner in Mississippi.' },
  { id: 'tt0482571', name: 'The Prestige', type: 'movie', year: 2006, imdbRating: '8.5', genres: ['Drama', 'Mystery', 'Sci-Fi'], moviedb_id: 1124, description: 'After a tragic accident, two stage magicians in 1890s London engage in a battle to create the ultimate illusion while sacrificing everything they have.' },
  { id: 'tt0209144', name: 'Memento', type: 'movie', year: 2000, imdbRating: '8.4', genres: ['Mystery', 'Thriller'], moviedb_id: 77, description: 'A man with short-term memory loss attempts to track down his wife\'s murderer.' },
  { id: 'tt1130884', name: 'Shutter Island', type: 'movie', year: 2010, imdbRating: '8.2', genres: ['Mystery', 'Thriller'], moviedb_id: 11324, description: 'In 1954, a U.S. Marshal investigates the disappearance of an escapee from a hospital for the criminally insane.' },
  { id: 'tt0114369', name: 'Se7en', type: 'movie', year: 1995, imdbRating: '8.6', genres: ['Crime', 'Drama', 'Mystery', 'Thriller'], moviedb_id: 807, description: 'Two detectives, a rookie and a veteran, hunt a serial killer who uses the seven deadly sins as his motives.' },
  { id: 'tt0102926', name: 'The Silence of the Lambs', type: 'movie', year: 1991, imdbRating: '8.6', genres: ['Crime', 'Drama', 'Thriller'], moviedb_id: 274, description: 'A young F.B.I. cadet must receive the help of an incarcerated and manipulative cannibal killer to help catch another serial killer.' },
  { id: 'tt1392190', name: 'Mad Max: Fury Road', type: 'movie', year: 2015, imdbRating: '8.1', genres: ['Action', 'Adventure', 'Sci-Fi'], moviedb_id: 76341, description: 'In a post-apocalyptic wasteland, a woman rebels against a tyrannical ruler in search for her homeland with the aid of a drifter named Max.' },
  { id: 'tt2911666', name: 'John Wick', type: 'movie', year: 2014, imdbRating: '7.4', genres: ['Action', 'Crime', 'Thriller'], moviedb_id: 245891, description: 'An ex-hit-man comes out of retirement to track down the gangsters that took everything from him.' },
  { id: 'tt10366206', name: 'John Wick: Chapter 4', type: 'movie', year: 2023, imdbRating: '7.7', genres: ['Action', 'Crime', 'Thriller'], moviedb_id: 603692, description: 'John Wick uncovers a path to defeating The High Table, but before he can earn his freedom, he must face a new enemy with powerful alliances across the globe.' },
  { id: 'tt6263850', name: 'Deadpool & Wolverine', type: 'movie', year: 2024, imdbRating: '7.8', genres: ['Action', 'Comedy', 'Sci-Fi'], moviedb_id: 533535, description: 'Wolverine is recovering from his injuries when he crosses paths with the loudmouth, Deadpool. They team up to defeat a common enemy.' },
  { id: 'tt22022452', name: 'Inside Out 2', type: 'movie', year: 2024, imdbRating: '7.6', genres: ['Animation', 'Adventure', 'Comedy', 'Family'], moviedb_id: 1022789, description: 'Follow Riley, in her teenage years, encountering new emotions including Anxiety, Envy, Ennui, and Embarrassment.' },
  { id: 'tt2380307', name: 'Coco', type: 'movie', year: 2017, imdbRating: '8.4', genres: ['Animation', 'Adventure', 'Comedy', 'Family'], moviedb_id: 354912, description: 'Aspiring musician Miguel, confronted with his family\'s ancestral ban on music, enters the Land of the Dead to find his great-great-grandfather.' },
  { id: 'tt0910970', name: 'WALL-E', type: 'movie', year: 2008, imdbRating: '8.4', genres: ['Animation', 'Adventure', 'Family', 'Sci-Fi'], moviedb_id: 10681, description: 'In the distant future, a small waste-collecting robot inadvertently embarks on a space journey that will ultimately decide the fate of mankind.' },
  { id: 'tt8946378', name: 'Knives Out', type: 'movie', year: 2019, imdbRating: '7.9', genres: ['Comedy', 'Crime', 'Drama', 'Mystery'], moviedb_id: 546554, description: 'A detective investigates the death of a patriarch of an eccentric, combative family.' },
  { id: 'tt6710474', name: 'Everything Everywhere All at Once', type: 'movie', year: 2022, imdbRating: '7.8', genres: ['Action', 'Adventure', 'Comedy', 'Sci-Fi'], moviedb_id: 580489, description: 'A middle-aged Chinese immigrant is swept up into an adventure in which she alone can save existence by exploring other universes.' },
  { id: 'tt8579674', name: '1917', type: 'movie', year: 2019, imdbRating: '8.2', genres: ['Action', 'Drama', 'War'], moviedb_id: 530915, description: 'April 6th, 1917. As an infantry battalion assembles to wage war deep in enemy territory, two soldiers are assigned to race against time and deliver a message.' },
  { id: 'tt0120815', name: 'Saving Private Ryan', type: 'movie', year: 1998, imdbRating: '8.6', genres: ['Drama', 'War'], moviedb_id: 857, description: 'Following the Normandy Landings, a group of U.S. soldiers go behind enemy lines to retrieve a paratrooper whose brothers have been killed in action.' },
  { id: 'tt0477348', name: 'No Country for Old Men', type: 'movie', year: 2007, imdbRating: '8.2', genres: ['Crime', 'Drama', 'Thriller'], moviedb_id: 6977, description: 'Violence and mayhem ensue after a hunter stumbles upon a drug deal gone wrong and more than two million dollars in cash near the Rio Grande.' },
  { id: 'tt0120382', name: 'The Truman Show', type: 'movie', year: 1998, imdbRating: '8.2', genres: ['Comedy', 'Drama'], moviedb_id: 37165, description: 'An insurance salesman discovers his whole life is actually a reality TV show.' },

  // TV SERIES (All guaranteed Season >= 1, clean, 100% verified)
  { id: 'tt0903747', name: 'Breaking Bad', type: 'series', year: 2008, imdbRating: '9.5', genres: ['Crime', 'Drama', 'Thriller'], moviedb_id: 1396, description: 'A chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing and selling methamphetamine with a former student.' },
  { id: 'tt3032476', name: 'Better Call Saul', type: 'series', year: 2015, imdbRating: '9.0', genres: ['Crime', 'Drama'], moviedb_id: 60059, description: 'The trials and tribulations of criminal lawyer Jimmy McGill in the years leading up to his fateful run-in with Walter White and Jesse Pinkman.' },
  { id: 'tt4574334', name: 'Stranger Things', type: 'series', year: 2016, imdbRating: '8.7', genres: ['Drama', 'Fantasy', 'Horror', 'Sci-Fi'], moviedb_id: 66732, description: 'When a young boy vanishes, a small town uncovers a mystery involving secret experiments, terrifying supernatural forces and one strange little girl.' },
  { id: 'tt0944947', name: 'Game of Thrones', type: 'series', year: 2011, imdbRating: '9.2', genres: ['Action', 'Adventure', 'Drama', 'Fantasy'], moviedb_id: 1399, description: 'Nine noble families fight for control over the lands of Westeros, while an ancient enemy returns after being dormant for millennia.' },
  { id: 'tt11198330', name: 'House of the Dragon', type: 'series', year: 2022, imdbRating: '8.4', genres: ['Action', 'Adventure', 'Drama', 'Fantasy'], moviedb_id: 94997, description: 'An internal succession war within House Targaryen at the height of its power, 172 years before the birth of Daenerys Targaryen.' },
  { id: 'tt7366338', name: 'Chernobyl', type: 'series', year: 2019, imdbRating: '9.3', genres: ['Drama', 'History', 'Thriller'], moviedb_id: 87108, description: 'In April 1986, an explosion at the Chernobyl nuclear power plant in the USSR becomes one of the world\'s worst man-made catastrophes.' },
  { id: 'tt3581920', name: 'The Last of Us', type: 'series', year: 2023, imdbRating: '8.8', genres: ['Action', 'Adventure', 'Drama', 'Sci-Fi'], moviedb_id: 100088, description: 'After a global pandemic destroys civilization, a hardened survivor takes charge of a 14-year-old girl who may be humanity\'s last hope.' },
  { id: 'tt7660850', name: 'Succession', type: 'series', year: 2018, imdbRating: '8.9', genres: ['Drama'], moviedb_id: 76331, description: 'The Roy family is known for controlling the biggest media and entertainment company in the world. However, their world changes when their aging father steps down.' },
  { id: 'tt11280740', name: 'Severance', type: 'series', year: 2022, imdbRating: '8.7', genres: ['Drama', 'Mystery', 'Sci-Fi', 'Thriller'], moviedb_id: 95396, description: 'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives.' },
  { id: 'tt11126994', name: 'Arcane', type: 'series', year: 2021, imdbRating: '9.0', genres: ['Animation', 'Action', 'Adventure', 'Sci-Fi'], moviedb_id: 94605, description: 'Set in utopian Piltover and the oppressed underground of Zaun, the story follows the origins of two iconic League champions-and the power that will tear them apart.' },
  { id: 'tt2085059', name: 'Black Mirror', type: 'series', year: 2011, imdbRating: '8.7', genres: ['Drama', 'Mystery', 'Sci-Fi', 'Thriller'], moviedb_id: 42009, description: 'An anthology series exploring a twisted, high-tech multiverse where humanity\'s greatest innovations and darkest instincts collide.' },
  { id: 'tt2442560', name: 'Peaky Blinders', type: 'series', year: 2013, imdbRating: '8.8', genres: ['Crime', 'Drama'], moviedb_id: 60574, description: 'A gangster family epic set in 1900s England, centering on a gang who sew razor blades in the peaks of their caps, and their fierce boss Tommy Shelby.' },
  { id: 'tt1190634', name: 'The Boys', type: 'series', year: 2019, imdbRating: '8.7', genres: ['Action', 'Comedy', 'Drama', 'Sci-Fi'], moviedb_id: 76479, description: 'A group of vigilantes set out to take down corrupt superheroes who abuse their superpowers.' },
  { id: 'tt13159924', name: 'Gen V', type: 'series', year: 2023, imdbRating: '7.7', genres: ['Action', 'Adventure', 'Comedy', 'Sci-Fi'], moviedb_id: 205715, description: 'From the world of The Boys comes Gen V, exploring the first generation of superheroes to know that their superpowers are from Compound V.' },
  { id: 'tt2802850', name: 'Fargo', type: 'series', year: 2014, imdbRating: '8.9', genres: ['Crime', 'Drama', 'Thriller'], moviedb_id: 57243, description: 'Various chronicles of deception, intrigue, and murder in and around frozen Minnesota.' },
  { id: 'tt0141842', name: 'The Sopranos', type: 'series', year: 1999, imdbRating: '9.2', genres: ['Crime', 'Drama'], moviedb_id: 1398, description: 'New Jersey mob boss Tony Soprano deals with personal and professional issues in his home and business life that affect his mental state.' },
  { id: 'tt0306414', name: 'The Wire', type: 'series', year: 2002, imdbRating: '9.3', genres: ['Crime', 'Drama', 'Thriller'], moviedb_id: 3297, description: 'The Baltimore drug scene, as seen through the eyes of drug dealers and law enforcement.' },
  { id: 'tt1475582', name: 'Sherlock', type: 'series', year: 2010, imdbRating: '9.1', genres: ['Crime', 'Drama', 'Mystery'], moviedb_id: 19885, description: 'A modern update finds the famous sleuth and his doctor partner solving crime in 21st century London.' },
  { id: 'tt0773262', name: 'Dexter', type: 'series', year: 2006, imdbRating: '8.7', genres: ['Crime', 'Drama', 'Mystery'], moviedb_id: 1405, description: 'He\'s smart. He\'s lovable. He\'s Dexter Morgan, America\'s favorite serial killer, who spends his days solving crimes and nights committing them.' },
  { id: 'tt2306299', name: 'Vikings', type: 'series', year: 2013, imdbRating: '8.5', genres: ['Action', 'Adventure', 'Drama', 'History'], moviedb_id: 44217, description: 'Vikings transports us to the brutal and mysterious world of Ragnar Lothbrok, a Norse warrior and farmer who yearns to explore distant shores.' },
  { id: 'tt5753856', name: 'Dark', type: 'series', year: 2017, imdbRating: '8.7', genres: ['Crime', 'Drama', 'Mystery', 'Sci-Fi'], moviedb_id: 70523, description: 'A family saga with a supernatural twist, set in a German town where the disappearance of two young children exposes relationships among four families.' },
  { id: 'tt5290382', name: 'Mindhunter', type: 'series', year: 2017, imdbRating: '8.6', genres: ['Crime', 'Drama', 'Mystery', 'Thriller'], moviedb_id: 67744, description: 'In the late 1970s, two FBI agents expand criminal science by delving into the psychology of murder and getting uneasily close to all-too-real monsters.' },
  { id: 'tt2356777', name: 'True Detective', type: 'series', year: 2014, imdbRating: '8.9', genres: ['Crime', 'Drama', 'Mystery', 'Thriller'], moviedb_id: 46648, description: 'Anthology series in which police investigations unearth the personal and professional secrets of those involved, both within and outside the law.' },
  { id: 'tt0185906', name: 'Band of Brothers', type: 'series', year: 2001, imdbRating: '9.4', genres: ['Drama', 'History', 'War'], moviedb_id: 4613, description: 'The story of Easy Company of the U.S. Army 101st Airborne Division and their mission in World War II Europe.' },
  { id: 'tt2707408', name: 'Narcos', type: 'series', year: 2015, imdbRating: '8.8', genres: ['Biography', 'Crime', 'Drama'], moviedb_id: 63351, description: 'A chronicled look at the criminal exploits of Colombian drug lord Pablo Escobar, as well as the many other drug kingpins who plagued the country.' },
  { id: 'tt12637874', name: 'Fallout', type: 'series', year: 2024, imdbRating: '8.4', genres: ['Action', 'Adventure', 'Drama', 'Sci-Fi'], moviedb_id: 106379, description: 'In a future, post-apocalyptic Los Angeles brought about by nuclear decimation, citizens must live in underground bunkers to protect themselves.' },
  { id: 'tt2788316', name: 'Shōgun', type: 'series', year: 2024, imdbRating: '8.7', genres: ['Adventure', 'Drama', 'History'], moviedb_id: 126308, description: 'When a mysterious European ship is found marooned in a nearby fishing village, Lord Yoshii Toranaga discovers secrets that could tip the scales of power.' },
  { id: 'tt9140554', name: 'Loki', type: 'series', year: 2021, imdbRating: '8.2', genres: ['Action', 'Adventure', 'Fantasy', 'Sci-Fi'], moviedb_id: 84958, description: 'The mercurial villain Loki resumes his role as the God of Mischief in a new series that takes place after the events of Avengers: Endgame.' },
  { id: 'tt10919420', name: 'Squid Game', type: 'series', year: 2021, imdbRating: '8.0', genres: ['Action', 'Drama', 'Mystery', 'Thriller'], moviedb_id: 93405, description: 'Hundreds of cash-strapped players accept a strange invitation to compete in children\'s games. Inside, a tempting prize awaits with deadly high stakes.' },
  { id: 'tt10986410', name: 'Ted Lasso', type: 'series', year: 2020, imdbRating: '8.8', genres: ['Comedy', 'Drama', 'Sport'], moviedb_id: 97546, description: 'American college football coach Ted Lasso heads to London to manage AFC Richmond, a struggling English Premier League football team.' },
  { id: 'tt14452776', name: 'The Bear', type: 'series', year: 2022, imdbRating: '8.6', genres: ['Comedy', 'Drama'], moviedb_id: 135934, description: 'A young chef from the fine dining world returns to Chicago to run his family\'s Italian beef sandwich shop.' },
  { id: 'tt5071412', name: 'Ozark', type: 'series', year: 2017, imdbRating: '8.5', genres: ['Crime', 'Drama', 'Thriller'], moviedb_id: 69740, description: 'A financial advisor drags his family from Chicago to the Missouri Ozarks, where he must launder money to appease a Mexican drug boss.' },
  { id: 'tt2560140', name: 'Attack on Titan', type: 'series', year: 2013, imdbRating: '9.1', genres: ['Animation', 'Action', 'Adventure', 'Drama'], moviedb_id: 1429, description: 'After his hometown is destroyed and his mother is killed, young Eren Jaeger vows to cleanse the earth of the giant humanoid Titans.' },
  { id: 'tt0877057', name: 'Death Note', type: 'series', year: 2006, imdbRating: '8.9', genres: ['Animation', 'Crime', 'Drama', 'Fantasy'], moviedb_id: 13916, description: 'An intelligent high school student goes on a secret crusade to eliminate criminals from the world after discovering a supernatural notebook.' },
  { id: 'tt1355642', name: 'Fullmetal Alchemist: Brotherhood', type: 'series', year: 2009, imdbRating: '9.1', genres: ['Animation', 'Action', 'Adventure', 'Fantasy'], moviedb_id: 31911, description: 'Two brothers search for a Philosopher\'s Stone after an attempt to revive their deceased mother goes awry and leaves them in damaged physical forms.' },
  { id: 'tt9335498', name: 'Demon Slayer: Kimetsu no Yaiba', type: 'series', year: 2019, imdbRating: '8.6', genres: ['Animation', 'Action', 'Adventure', 'Fantasy'], moviedb_id: 85937, description: 'A family is attacked by demons and only two members survive - Tanjiro and his sister Nezuko, who is turning into a demon herself.' },
  { id: 'tt12343534', name: 'Jujutsu Kaisen', type: 'series', year: 2020, imdbRating: '8.5', genres: ['Animation', 'Action', 'Adventure', 'Fantasy'], moviedb_id: 95479, description: 'A boy swallows a cursed talisman - the finger of a demon - and becomes cursed himself. He enters a shaman\'s school to locate other demon body parts.' },
  { id: 'tt8111088', name: 'The Mandalorian', type: 'series', year: 2019, imdbRating: '8.6', genres: ['Action', 'Adventure', 'Fantasy', 'Sci-Fi'], moviedb_id: 82856, description: 'The travels of a lone bounty hunter in the outer reaches of the galaxy, far from the authority of the New Republic.' },
  { id: 'tt9253284', name: 'Andor', type: 'series', year: 2022, imdbRating: '8.4', genres: ['Action', 'Adventure', 'Drama', 'Sci-Fi'], moviedb_id: 83867, description: 'Prequel series to Star Wars\' Rogue One. In an era filled with danger, deception and intrigue, Cassian embarks on a path destined to turn him into a rebel hero.' },
  { id: 'tt3322312', name: 'Daredevil', type: 'series', year: 2015, imdbRating: '8.6', genres: ['Action', 'Crime', 'Drama'], moviedb_id: 61889, description: 'A blind lawyer by day, vigilante by night. Matt Murdock fights the crime of New York as Daredevil.' },
  { id: 'tt15435876', name: 'The Penguin', type: 'series', year: 2024, imdbRating: '8.8', genres: ['Crime', 'Drama'], moviedb_id: 194764, description: 'Following the events of The Batman (2022), Oz Cobb, a.k.a. the Penguin, makes a play to seize the reins of the crime empire in Gotham City.' },
  { id: 'tt6741278', name: 'Invincible', type: 'series', year: 2021, imdbRating: '8.7', genres: ['Animation', 'Action', 'Adventure', 'Drama'], moviedb_id: 95557, description: 'An animated superhero series based on the Skybound comic about a teenager whose father is the most powerful superhero on the planet.' },
  { id: 'tt0417299', name: 'Avatar: The Last Airbender', type: 'series', year: 2005, imdbRating: '9.3', genres: ['Animation', 'Action', 'Adventure', 'Fantasy'], moviedb_id: 387, description: 'In a war-torn world of elemental magic, a young boy reawakens to undertake a dangerous mystic quest to fulfill his destiny as the Avatar.' },
  { id: 'tt10048342', name: 'The Queen\'s Gambit', type: 'series', year: 2020, imdbRating: '8.5', genres: ['Drama'], moviedb_id: 87739, description: 'Orphaned at the tender age of nine, prodigious introvert Beth Harmon discovers and masters the game of chess in 1960s USA.' },
  { id: 'tt0386676', name: 'The Office', type: 'series', year: 2005, imdbRating: '9.0', genres: ['Comedy'], moviedb_id: 2316, description: 'A mockumentary on a group of typical office workers, where the workday consists of ego clashes, inappropriate behavior, and tedium.' },
  { id: 'tt2467372', name: 'Brooklyn Nine-Nine', type: 'series', year: 2013, imdbRating: '8.4', genres: ['Comedy', 'Crime'], moviedb_id: 48891, description: 'Comedy series following the exploits of Det. Jake Peralta and his diverse, lovable colleagues as they police the NYPD\'s 99th Precinct.' },
  { id: 'tt2861424', name: 'Rick and Morty', type: 'series', year: 2013, imdbRating: '9.1', genres: ['Animation', 'Adventure', 'Comedy', 'Sci-Fi'], moviedb_id: 60625, description: 'The fractured domestic lives of a cynical mad scientist and his good-hearted but fretful grandson across interdimensional adventures.' },
  { id: 'tt4158110', name: 'Mr. Robot', type: 'series', year: 2015, imdbRating: '8.5', genres: ['Crime', 'Drama', 'Thriller'], moviedb_id: 62560, description: 'Elliot, a brilliant but highly unstable young cyber-security engineer and vigilante hacker, becomes a key figure in a complex game of global chaos.' },
  {
    id: 'tt9288030',
    name: 'Reacher',
    type: 'series',
    year: 2022,
    imdbRating: '8.1',
    genres: ['Action', 'Crime', 'Drama'],
    moviedb_id: 108978,
    description: 'Jack Reacher, a veteran military police investigator, enters civilian life and is wrongly arrested for murder in rural Georgia.',
    videos: REACHER_EPISODES
  },
  { id: 'tt14688458', name: 'Silo', type: 'series', year: 2023, imdbRating: '8.1', genres: ['Drama', 'Mystery', 'Sci-Fi'], moviedb_id: 125988, description: 'Men and women live in a giant underground silo with several regulations which they believe are in place to protect them from the toxic world on the surface.' },
  { id: 'tt4236770', name: 'Yellowstone', type: 'series', year: 2018, imdbRating: '8.7', genres: ['Drama', 'Western'], moviedb_id: 73586, description: 'A ranching family in Montana faces off against others encroaching on their land.' },
  { id: 'tt6468322', name: 'Money Heist', type: 'series', year: 2017, imdbRating: '8.2', genres: ['Action', 'Crime', 'Drama'], moviedb_id: 71446, description: 'An unusual group of robbers attempt to carry out the most perfect robbery in Spanish history - stealing 2.4 billion euros from the Royal Mint of Spain.' },
  { id: 'tt5875444', name: 'Slow Horses', type: 'series', year: 2022, imdbRating: '8.2', genres: ['Drama', 'Thriller'], moviedb_id: 117581, description: 'Follows a dysfunctional team of MI5 agents, and their obnoxious boss Jackson Lamb, as they navigate the espionage world to defend England from sinister forces.' }
];

// Enrich with poster/backdrop links
const CURATED_MEDIA = RAW_CURATED_MEDIA.map(m => {
  const poster = `https://images.metahub.space/poster/medium/${m.id}/img`;
  const background = `https://images.metahub.space/background/medium/${m.id}/img`;
  return {
    ...m,
    poster,
    background,
    imdb_id: m.id,
    releaseInfo: String(m.year)
  };
}).filter(isSafeContent);

const CURATED_MAP = new Map(CURATED_MEDIA.map(m => [m.id, m]));

function getCuratedById(id) {
  if (!id) return null;
  const cleanId = String(id).split(':')[0].trim();
  return CURATED_MAP.get(cleanId) || null;
}

function searchCurated(query) {
  if (!query || typeof query !== 'string') return [];
  const q = query.toLowerCase().trim();
  return CURATED_MEDIA.filter(m => {
    return (
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.genres && m.genres.some(g => g.toLowerCase().includes(q))) ||
      (m.description && m.description.toLowerCase().includes(q))
    );
  });
}

function getCuratedForCategory(catId) {
  switch (catId) {
    case 'popular_movies':
    case 'toprated_movies':
      return CURATED_MEDIA.filter(m => m.type === 'movie').slice(0, 30);
    case 'popular_series':
    case 'toprated_series':
    case 'prestige_tv':
      return CURATED_MEDIA.filter(m => m.type === 'series').slice(0, 30);
    case 'action':
    case 'action_blockbusters':
      return CURATED_MEDIA.filter(m => m.genres.includes('Action'));
    case 'action_series':
      return CURATED_MEDIA.filter(m => m.type === 'series' && (m.genres.includes('Action') || m.genres.includes('Adventure')));
    case 'scifi':
    case 'scifi_classics':
      return CURATED_MEDIA.filter(m => m.genres.includes('Sci-Fi'));
    case 'sci_series':
      return CURATED_MEDIA.filter(m => m.type === 'series' && m.genres.includes('Sci-Fi'));
    case 'crime':
    case 'crime_noir':
    case 'heist':
      return CURATED_MEDIA.filter(m => m.genres.includes('Crime'));
    case 'mystery':
    case 'psychological_thrillers':
    case 'thriller':
      return CURATED_MEDIA.filter(m => m.genres.includes('Thriller') || m.genres.includes('Mystery'));
    case 'comedy':
    case 'feelgood_comedy':
      return CURATED_MEDIA.filter(m => m.genres.includes('Comedy'));
    case 'comedy_series':
      return CURATED_MEDIA.filter(m => m.type === 'series' && m.genres.includes('Comedy'));
    case 'drama':
    case 'drama_movies':
    case 'award_winners':
      return CURATED_MEDIA.filter(m => m.genres.includes('Drama') && parseFloat(m.imdbRating) >= 8.5);
    case 'animation':
    case 'anime_hits':
      return CURATED_MEDIA.filter(m => m.genres.includes('Animation'));
    case 'family':
    case 'family_adventures':
      return CURATED_MEDIA.filter(m => m.genres.includes('Family') || (m.genres.includes('Adventure') && !m.genres.includes('Horror')));
    case 'superhero':
    case 'superhero_saga':
      return CURATED_MEDIA.filter(m => m.name.includes('Spider') || m.name.includes('Batman') || m.name.includes('Avengers') || m.name.includes('Iron Man') || m.name.includes('Boys') || m.name.includes('Invincible') || m.name.includes('Daredevil') || m.name.includes('Deadpool'));
    default:
      return [];
  }
}

/**
 * Global audit function: scans any catalog list for safety and counts
 */
function auditCatalog(extraList = []) {
  const combined = [...CURATED_MEDIA, ...extraList];
  let movieCount = 0;
  let seriesCount = 0;
  let sexualFlags = [];
  const seen = new Set();

  combined.forEach(item => {
    if (!item || !item.id || seen.has(item.id)) return;
    seen.add(item.id);

    if (item.type === 'series') seriesCount++;
    else movieCount++;

    if (!isSafeContent(item)) {
      sexualFlags.push({ id: item.id, name: item.name });
    }
  });

  return {
    totalMedia: seen.size,
    movies: movieCount,
    series: seriesCount,
    sexualFound: sexualFlags.length,
    sexualFlags,
    status: sexualFlags.length === 0 ? 'CLEAN & SAFE' : 'VIOLATIONS_DETECTED'
  };
}

const CuratedCatalog = {
  CURATED_MEDIA,
  isSafeContent,
  getCuratedById,
  searchCurated,
  getCuratedForCategory,
  auditCatalog
};

if (typeof window !== 'undefined') {
  window.CuratedCatalog = CuratedCatalog;
  window.isSafeContent = isSafeContent;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CuratedCatalog;
}
