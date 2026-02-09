import express from 'express';
import cors from 'cors';
import pokemon from './schema/pokemon.js';

import './connect.js'

const app = express();
app.use(cors());
app.use(express.json());

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

app.post('/pokemonCreate', async (req, res) => {
  try{
    const pokemons = await pokemon.find({});
    const { name, type, base, image } = req.body;
    const newPokemon = { 
      id: pokemons.length + 1, 
      name,
      type,
      base,
      image 
    };
    const savedPokemon = await pokemon.create(newPokemon);
    res.status(201).json(savedPokemon.toObject({ versionKey: false }));
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
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
