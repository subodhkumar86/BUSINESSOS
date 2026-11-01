# Low-stock task automation

In **Workflows & Automation**, an owner or operations manager can enable **Low-stock task automation**, then select **Run stock review now**. The workspace plan must include both automation and operations. Auditors can inspect settings and run history but cannot change settings or execute a run.

Each run checks current product quantities. When quantity is strictly below the reorder threshold, it creates a task named `Review low stock: SKU — Product`. Tasks appear in **Projects & Tasks**. The run does not change inventory, create purchase orders, move funds or send notifications.

An existing open task created by this automation is reused. Completing that task allows a new review on a later run if the item remains low. Recovering stock does not automatically complete a human review task. Tasks created manually outside this automation are not treated as its linked review tasks.

A run creates at most 50 new tasks and reports matched, created, already-open and deferred counts. Run again to process deferred products. Task creation, source links, run history and audit save in one transaction. Retrying the same run with its idempotency key returns the committed result instead of creating tasks again. Settings reject stale versions. The panel displays the latest 50 runs.

Manual mode is the default. You can also choose **Hourly** or **Daily** under **Stock review schedule** and save it. The panel shows the next eligible time and identifies manual versus scheduled runs. Pausing automation clears its next eligible time. Changing the schedule resets eligibility from the time it is saved. **Refresh automation** reloads settings/history if another operator or worker has updated them.

Schedules execute only when your deployment scheduler invokes **GET or POST `/api/v1/internal/automation/run`**, with `Authorization: Bearer <CRON_SECRET>`. Keep the same random secret of at least 32 characters in the deployment and scheduler secret stores. The trusted command `npm run automation:run` can instead process one batch using deployment database variables. This work did not run that command against production, configure an external scheduler or activate a live schedule.

Each worker call considers at most three due workspaces and creates up to ten new tasks per workspace. Backlogged work becomes eligible again after one minute; otherwise the next eligible time follows the chosen interval. Actual execution depends on worker invocation frequency. No catch-up run is created for each missed interval. Tasks, run history and schedule advancement commit atomically, and concurrent worker calls recheck eligibility under the tenant lock. A failed transaction leaves the schedule due for retry. Monitor worker `failed`, `blocked` and `deferred` counts.

The worker rechecks the scheduling account's active status and owner/operations role, plus current automation and operations entitlements. Losing access blocks the schedule and clears its next time. An authorised user must restore access as needed and explicitly save the schedule again. A worker update changes the settings version; stale UI changes must refresh before saving.

There is no stock-change event trigger. Free-text rules elsewhere on the page store review notes only; they do not execute arbitrary conditions/actions. Their button is labelled **Record review** accordingly.

Before releasing this feature, run the existing idempotent `npm run db:migrate` against the deployment database to install its unique settings/product-link and due-schedule indexes. This task has not changed production data or enabled an external scheduler.
