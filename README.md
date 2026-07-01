# Pistas Cruzadas Online

Juego cooperativo online hecho con SvelteKit, Supabase y GitHub Pages.

## Inicio rápido

1. Creá un proyecto de Supabase.
2. Activá **Anonymous Sign-Ins**.
3. Ejecutá `supabase/setup.sql` en el SQL Editor.
4. Pegá tu Project URL y Publishable key en `src/lib/supabase-config.js`.
5. Ejecutá:

```bash
npm install
npm run dev -- --open
```

El tutorial completo está en [TUTORIAL.md](./TUTORIAL.md).

## Comandos

```bash
npm run dev
npm run check
npm run build
npm run preview
```

## Publicación

El workflow `.github/workflows/deploy.yml` publica automáticamente el proyecto en GitHub Pages cuando se hace `push` a `main`.

## Seguridad

No uses una `service_role` key en este proyecto. El frontend solo necesita la Publishable key o la antigua `anon public` key. Las escrituras pasan por funciones SQL y las lecturas están protegidas por RLS.
