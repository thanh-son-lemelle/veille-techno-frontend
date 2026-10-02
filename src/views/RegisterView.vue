<template>
  <UCard class="mx-auto max-w-md">
    <template #header>
      <h1 class="text-2xl font-semibold">Inscription</h1>
    </template>
    <div class="space-y-3">
      <p>label d'inscription.</p>
      <p class="text-muted">La création de compte est en cours de construction.</p>
    </div>
    <template #footer>
      <p class="mb-3 text-sm text-muted">Vous avez déjà un compte ?</p>
      <UButton to="/connexion" color="neutral" variant="outline">Aller à la connexion</UButton>
    </template>
  </UCard>
</template>
