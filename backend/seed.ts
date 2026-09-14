import { db } from './src/db';
import bcrypt from 'bcryptjs';

async function seed() {
  try {
    console.log('Creando tabla usuarios...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        rol VARCHAR(20) NOT NULL
      );
    `);

    console.log('Creando tabla vehiculos_usuarios...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS vehiculos_usuarios (
        dispositivo_id VARCHAR(50) NOT NULL,
        usuario_id INTEGER REFERENCES usuarios(id),
        PRIMARY KEY (dispositivo_id, usuario_id)
      );
    `);

    console.log('Limpiando usuarios antiguos...');
    await db.query(`DELETE FROM vehiculos_usuarios`);
    await db.query(`DELETE FROM usuarios`);

    const hashPass = await bcrypt.hash('1234', 10);

    console.log('Insertando admin, cliente1, cliente2...');
    await db.query(`
      INSERT INTO usuarios (id, username, password_hash, rol) VALUES 
      (1, 'admin', $1, 'admin'),
      (2, 'cliente1', $1, 'cliente'),
      (3, 'cliente2', $1, 'cliente')
    `, [hashPass]);

    console.log('Asignando vehiculos...');
    await db.query(`
      INSERT INTO vehiculos_usuarios (dispositivo_id, usuario_id) VALUES 
      ('Camion-1', 2),
      ('Camion-2', 3)
    `);

    console.log('Semilla completada exitosamente.');
  } catch (error) {
    console.error('Error al sembrar base de datos:', error);
  } finally {
    process.exit(0);
  }
}

seed();
