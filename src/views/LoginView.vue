<template>
  <UCard class="mx-auto max-w-md">
    <template #header>
      <h1 class="text-2xl font-semibold">Connexion</h1>
    </template>
    <div class="space-y-3">
      <p>Espace de connexion.</p>
      <p class="text-muted">La connexion sera bientôt disponible.</p>
    </div>
    <template #footer>
      <p class="mb-3 text-sm text-muted">Vous n’avez pas encore de compte ?</p>
      <UButton to="/inscription" color="neutral" variant="outline">Aller à l’inscription</UButton>
    </template>
  </UCard>
</template>
