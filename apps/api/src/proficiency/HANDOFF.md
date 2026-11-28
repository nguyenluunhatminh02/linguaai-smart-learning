# Peer handoff: register new modules in app.module.ts

`apps/api/src/app.module.ts` is peer-owned, so `ProficiencyModule` and `ContentWorkflowModule`
are intentionally **not** imported there by the writer that created them. The owner of
`app.module.ts` must add exactly these two imports and include both classes in the root
`@Module({ imports: [...] })` array:

```ts
import { ProficiencyModule } from './proficiency/proficiency.module';
import { ContentWorkflowModule } from './content-workflow/content-workflow.module';

@Module({
  imports: [
    // ...existing imports unchanged...
    ProficiencyModule,
    ContentWorkflowModule,
  ],
})
export class AppModule {}
```

Without this registration the HTTP routes provided by `ProficiencyController`
(`/proficiency/...`) and `ContentWorkflowController` (`/content-workflow/...`) are not mounted,
and `ProficiencyService` is not available for injection into other API modules. No other
changes to `app.module.ts` are required.
