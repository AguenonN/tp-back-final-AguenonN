import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import pokemon from './schema/pokemon.js';

import './connect.js'

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  };

  const fromType = contentTypeMap[(contentType || '').toLowerCase()];
  if (fromType) return fromType;

  const cleanUrl = (imageUrl || '').split('?')[0].toLowerCase();
  const ext = path.extname(cleanUrl);
  return ext || '.png';
}

async function downloadPokemonImage(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Image download failed with status ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error('Provided URL does not point to an image');
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
  try{
    const pokemons = await pokemon.find({});
    res.json(pokemons);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
})

app.get('/pokemonsByPage/:page', async (req, res) => {
  try {
    const page = parseInt(req.params.page, 10) || 0; // Utilise 'page' et base 10
    const pokemons = await pokemon.find({})
                                 .limit(20)
                                 .skip(20 * page);
    res.json(pokemons);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

app.get('/pokemons/:id', async (req, res) => {
  try{
    const pokeId = parseInt(req.params.id, 10);
    const poke = await pokemon.findOne({ id: pokeId });
    if (poke) {
      res.json(poke);
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
})

app.get('/pokemonByName/:name', async (req, res) => {
  try{
    const pokeName = req.params.name;
    const poke = await pokemon.findOne({ "name.english": pokeName });
    if (poke) {
      res.json(poke);
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
})

app.get('/pokemonExactByName/:name', async (req, res) => {
  try {
    const inputName = (req.params.name || "").trim();
    if (!inputName) {
      return res.status(400).json({ error: 'name is required' });
    }

    const escaped = inputName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactRegex = new RegExp(`^${escaped}$`, "i");

    const poke = await pokemon.findOne({
      $or: [
        { "name.english": { $regex: exactRegex } },
        { "name.french": { $regex: exactRegex } },
      ],
    });

    if (!poke) {
      return res.status(404).json({ error: 'Pokemon not found' });
    }

    res.json(poke);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/pokemonsSearch', async (req, res) => {
  try {
    const name = (req.query.name || "").trim();
    if (!name) {
      return res.json([]);
    }

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameRegex = new RegExp(escaped, "i");

    const pokemons = await pokemon
      .find({
        $or: [
          { "name.english": { $regex: nameRegex } },
          { "name.french": { $regex: nameRegex } },
        ],
      })
      .limit(50);

    res.json(pokemons);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/pokemonCreate', async (req, res) => {
  try{
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
        { 'name.english': { $regex: new RegExp(`^${name.english.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, 'i') } },
        { 'name.french': { $regex: new RegExp(`^${name.french.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, 'i') } },
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
    res.status(201).json(savedPokemon.toObject({ versionKey: false }));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

app.put('/pokemonUpdate/:name', async (req, res) => {
  try {
    const pokeName = req.params.name;
    const pokemonUpdate = req.body;
    const updatedPoke = await pokemon.findOneAndUpdate(
      { "name.english": pokeName },
      pokemonUpdate,
      { new: true }
    );
    if (!updatedPoke) {
      return res.status(404).json({ message: 'Pokemon not found' });
    }
    res.status(200).json(updatedPoke.toObject({ versionKey: false }));
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.delete('/pokemonDelete/:name' , async (req, res) => {
  try{
    const pokeName = req.params.name;
    const poke = await pokemon.findOneAndDelete({ "name.english": pokeName });
    if (poke) {
      res.json({ message: 'Pokemon deleted', pokemon: poke });
    } else {
      res.status(404).json({ error: 'Pokemon not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
})

app.get('/goodbye', (req, res) => {
  res.send('Goodbye Moon Man!');
});


console.log('Server is set up. Ready to start listening on a port.');

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});
