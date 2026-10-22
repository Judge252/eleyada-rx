-- Read-only retry metadata for ONLY the two authorized synthetic histories.
-- No reference values, digests, Vault values, medication or patient contents.
begin read only;
set local statement_timeout='5s';
set local lock_timeout='1s';
select jsonb_build_object(
 'issuance',(select jsonb_agg(jsonb_build_object('id',r.prescription_id,'request',r.request_id,'version',r.draft_version,'fingerprint',r.review_fingerprint)) from rx_private.issuance_receipts r where r.prescription_id in ('423504eb-b50d-4d09-b19a-2009c4d92911','4bbcd887-f4d1-4ae3-a7c7-cbdefdaec3a1')),
 'cancellation',(select jsonb_build_object('id',prescription_id,'request',request_id,'version',issued_version,'reason',reason,'cancelled_at',cancelled_at) from rx_private.cancellation_receipts where prescription_id='4bbcd887-f4d1-4ae3-a7c7-cbdefdaec3a1')
) as retry_metadata;
commit;
