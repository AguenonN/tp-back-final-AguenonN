import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { createHmac } from 'crypto';
import { fileURLToPath } from 'url';
import pokemon from './schema/pokemon.js';
import auditLog from './schema/auditLog.js';

import './connect.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INTEGRITY_SECRET = process.env.INTEGRITY_SECRET || 'pokedex-zero-trust-seal';

app.use(cors());
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

function buildPublicAssetUrl(req, fileName) {
  return `${req.protocol}://${req.get('host')}/assets/pokemons/${fileName}`;
}

function getImageExtension(contentType, imageUrl) {
  const contentTypeMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
  };

  const fromType = contentTypeMap[(contentType || '').toLowerCase()];
  if (fromType) return fromType;

  const cleanUrl = (imageUrl || '').split('?')[0].toLowerCase();
  const ext = path.extname(cleanUrl);
  return ext || '.png';
}

function resolveDownloadUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (parsed.hostname === 'external-content.duckduckgo.com') {
    const original = parsed.searchParams.get('u');
    if (original) {
      try {
        return decodeURIComponent(original);
      } catch {
        return original;
      }
    }
  }

  return rawUrl;
}

function normalizeForSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function generateIntegritySeal(stats = {}, secret = INTEGRITY_SECRET) {
  const sortedKeys = Object.keys(stats).sort((a, b) => a.localeCompare(b));
  const sortedStats = sortedKeys.reduce((acc, key) => {
    acc[key] = stats[key];
    return acc;
  }, {});

  return createHmac('sha256', secret)
    .update(JSON.stringify(sortedStats))
    .digest('hex');
}

function withIntegrityHash(doc) {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject({ versionKey: false }) : { ...doc };
  return {
    ...plain,
    integrityHash: generateIntegritySeal(plain.base),
  };
}

function getSourceIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function extractPokemonNameForAudit(req) {
  const fromParams = req.params?.name;
  if (fromParams) return decodeURIComponent(fromParams);

  const bodyName = req.body?.name;
  if (typeof bodyName === 'string' && bodyName.trim()) return bodyName.trim();
  if (bodyName?.english) return String(bodyName.english).trim();
  if (bodyName?.french) return String(bodyName.french).trim();

  return 'unknown';
}

function destructiveAuditMiddleware(req, res, next) {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
    return next();
  }

  const actionMap = {
    POST: 'CREATE',
    PUT: 'UPDATE',
    DELETE: 'DELETE',
  };

  const action = actionMap[req.method] || req.method;
  const pokemonName = extractPokemonNameForAudit(req);
  const sourceIp = getSourceIp(req);

  res.on('finish', async () => {
    try {
      await auditLog.create({
        action,
        pokemonName,
        sourceIp,
        statusCode: res.statusCode,
      });
    } catch (error) {
      console.error('Audit log write failed:', error.message);
    }
  });

  next();
}

app.use(destructiveAuditMiddleware);

async function downloadPokemonImage(imageUrl) {
  const resolvedUrl = resolveDownloadUrl(imageUrl);
  const response = await fetch(resolvedUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      referer: 'https://duckduckgo.com/',
    },
  });
  if (!response.ok) {
    throw new Error(`Image download failed (${response.status}) from ${resolvedUrl}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`Provided URL did not return an image (content-type: ${contentType || 'unknown'})`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType,
  };
}

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

app.get('/pokemons', async (req, res) => {
  try {
    const pokemons = await pokemon.find({});
    res.json(pokemons.map(withIntegrityHash));
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/pokemonsByPage/:page', async (req, res) => {
  try {
    const page = parseInt(req.params.page, 10) || 0;
    const pokemons = await pokemon.find({})
      .limit(20)
      .skip(20 * page);
    res.json(pokemons.map(withIntegrityHash));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/pokemons/:id', async (req, res) => {
  try {
    const pokeId = parseInt(req.params.id, 10);
    const poke = await pokemon.findOne({ id: pokeId });
    if (!poke) {
      return res.status(404).json({ error: 'Pokemon not found' });
    }
    res.json(withIntegrityHash(poke));
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/pokemonByName/:name', async (req, res) => {
  try {
    const pokeName = req.params.name;
    const poke = await pokemon.findOne({ 'name.english': pokeName });
    if (!poke) {
      return res.status(404).json({ error: 'Pokemon not found' });
    }
    res.json(withIntegrityHash(poke));
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/pokemonExactByName/:name', async (req, res) => {
  try {
    const inputName = (req.params.name || '').trim();
    if (!inputName) {
      return res.status(400).json({ error: 'name is required' });
    }

    const escaped = inputName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactRegex = new RegExp(`^${escaped}$`, 'i');

    const poke = await pokemon.findOne({
      $or: [
        { 'name.english': { $regex: exactRegex } },
        { 'name.french': { $regex: exactRegex } },
      ],
    });

    if (!poke) {
      return res.status(404).json({ error: 'Pokemon not found' });
    }

    res.json(withIntegrityHash(poke));
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/pokemonsSearch', async (req, res) => {
  try {
    const name = (req.query.name || '').trim();
    if (!name) {
      return res.json([]);
    }

    const normalizedQuery = normalizeForSearch(name);
    const allPokemons = await pokemon.find({}).limit(1000).lean();
    const pokemons = allPokemons
      .filter((p) => {
        const english = normalizeForSearch(p?.name?.english);
        const french = normalizeForSearch(p?.name?.french);
        return english.includes(normalizedQuery) || french.includes(normalizedQuery);
      })
      .slice(0, 50)
      .map(withIntegrityHash);

    res.json(pokemons);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/auditLogs/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name || '').trim();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '20', 10), 100));

    const logs = await auditLog.find({ pokemonName: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.delete('/pokemonsPurge', async (req, res) => {
  try {
    const result = await pokemon.deleteMany({});
    res.json({ message: 'Pokedex purged', deletedCount: result.deletedCount || 0 });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/pokemonCreate', async (req, res) => {
  try {
    const { name, type, base, imageUrl } = req.body;

    if (!name?.english || !name?.french) {
      return res.status(400).json({ error: 'name.english and name.french are required' });
    }
    if (!Array.isArray(type) || type.length === 0) {
      return res.status(400).json({ error: 'type must be a non-empty array' });
    }
    if (!base || typeof base !== 'object') {
      return res.status(400).json({ error: 'base stats are required' });
    }
    if (!imageUrl || typeof imageUrl !== 'string') {
      return res.status(400).json({ error: 'imageUrl is required' });
    }

    const duplicate = await pokemon.findOne({
      $or: [
        { 'name.english': { $regex: new RegExp(`^${name.english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        { 'name.french': { $regex: new RegExp(`^${name.french.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
      ],
    });
    if (duplicate) {
      return res.status(409).json({ error: 'Pokemon already exists (english or french name)' });
    }

    const latestPokemon = await pokemon.findOne({}).sort({ id: -1 }).lean();
    const newId = (latestPokemon?.id || 0) + 1;
    const imageData = await downloadPokemonImage(imageUrl);
    const imageExt = getImageExtension(imageData.contentType, imageUrl);
    const imageFileName = `${newId}${imageExt}`;
    const imageDiskPath = path.join(__dirname, 'assets', 'pokemons', imageFileName);
    await fs.writeFile(imageDiskPath, imageData.buffer);

    const newPokemon = {
      id: newId,
      name,
      type,
      base,
      image: buildPublicAssetUrl(req, imageFileName),
    };
    const savedPokemon = await pokemon.create(newPokemon);
    res.status(201).json(withIntegrityHash(savedPokemon));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

app.put('/pokemonUpdate/:name', async (req, res) => {
  try {
    const pokeName = req.params.name;
    const pokemonUpdate = req.body;
    const updatedPoke = await pokemon.findOneAndUpdate(
      { 'name.english': pokeName },
      pokemonUpdate,
      { new: true }
    );
    if (!updatedPoke) {
      return res.status(404).json({ message: 'Pokemon not found' });
    }
    res.status(200).json(withIntegrityHash(updatedPoke));
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.delete('/pokemonDelete/:name', async (req, res) => {
  try {
    const pokeName = req.params.name;
    const poke = await pokemon.findOneAndDelete({ 'name.english': pokeName });
    if (poke) {
      res.json({ message: 'Pokemon deleted', pokemon: withIntegrityHash(poke) });
    } else {
      res.status(404).json({ error: 'Pokemon not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/goodbye', (req, res) => {
  res.send('Goodbye Moon Man!');
});

console.log('Server is set up. Ready to start listening on a port.');

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});
