# Pistas Cruzadas Online — actualización de reglas

Este proyecto usa:

- SvelteKit para la interfaz.
- Supabase Auth anónimo, PostgreSQL y Realtime.
- GitHub Pages para publicar la web gratis.

## 1. Importante si ya tenías la versión anterior

La versión anterior funcionaba por rondas y votos. Esta actualización reemplaza esa mecánica por la del juego original.

Tenés que volver a ejecutar completo:

```text
supabase/setup.sql
```

En Supabase:

1. Abrí **SQL Editor**.
2. Creá una consulta nueva.
3. Pegá todo el contenido de `supabase/setup.sql`.
4. Tocá **Run**.

El script borra las partidas y tablas anteriores de este juego. No modifica otros esquemas ajenos a Pistas Cruzadas.

## 2. Cómo funciona ahora

### Preparación

El anfitrión elige:

- Rápida: 3×3.
- Clásica: 4×4.
- Experta: 5×5.
- Con reloj o sin reloj.

Con reloj:

- 3×3 y 4×4: 5 minutos.
- 5×5: 10 minutos.

La partida admite de 2 a 6 personas.

### Reparto

- Con 2 o 3 jugadores, cada uno recibe dos tarjetas secretas.
- Con 4, 5 o 6 jugadores, cada uno recibe una tarjeta secreta.
- Cada tarjeta representa el cruce de una palabra horizontal y una vertical.

### Desarrollo

1. Todos piensan al mismo tiempo.
2. No existe un orden de turnos.
3. Cuando alguien tiene una pista, selecciona su tarjeta, escribe una sola palabra y la publica.
4. La primera pista que llega queda activa; los demás conservan sus tarjetas y esperan.
5. El grupo puede hablar por Discord, Meet, llamada o en persona.
6. Una sola persona toca la coordenada acordada.
7. La primera coordenada aceptada por Supabase es definitiva y no puede cambiarse.
8. Si es correcta, la tarjeta queda colocada en la grilla.
9. Si es incorrecta, la tarjeta se descarta sin mostrar su coordenada real.
10. Quien dio la pista roba automáticamente una tarjeta nueva si todavía quedan en el mazo.
11. Al resolverse la pista, cualquiera puede publicar la siguiente.

### Reglas de las pistas

- Deben ser de una sola palabra.
- Deben relacionar las dos palabras de la tarjeta.
- No pueden ser iguales a una de las palabras cruzadas.
- No deberían compartir la misma raíz con una palabra de la grilla.
- No pueden reutilizarse durante la partida, aunque la respuesta anterior haya sido incorrecta.

La web controla automáticamente que la pista no tenga espacios, no sea exactamente una de las palabras y no haya sido usada antes. La regla de la raíz se deja al criterio del grupo porque no puede comprobarse correctamente para todas las palabras.

### Final

La partida termina cuando:

- Se agota el tiempo; o
- No quedan tarjetas en el mazo ni en las manos de los jugadores.

La puntuación es la cantidad de tarjetas colocadas correctamente.

## 3. Probar localmente

Después de reemplazar los archivos y ejecutar el SQL:

```bash
npm ci
npm run dev -- --open
```

Para probar con dos personas:

1. Creá una sala en una ventana normal.
2. Copiá el enlace.
3. Abrilo en una ventana de incógnito o en otro navegador.
4. Entrá con otro nombre.
5. Iniciá la partida.

No uses dos pestañas normales del mismo perfil, porque compartirían el mismo usuario anónimo.

## 4. Comprobar antes de publicar

```bash
npm run check
npm run build
```

## 5. Publicar cambios en GitHub Pages

```bash
git add supabase/setup.sql src/lib/game.js src/routes/+page.svelte README.md TUTORIAL.md
git commit -m "Corregir reglas de Pistas Cruzadas"
git push
```

GitHub Actions volverá a compilar y publicar la página automáticamente.
