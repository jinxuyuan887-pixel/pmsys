ALTER TABLE `service_records` ADD `cost_unit_snapshot` integer;
ALTER TABLE `service_records` ADD `cost_amount_snapshot` integer;
ALTER TABLE `service_records` ADD `profit_rate_basis_points` integer;

UPDATE `service_records`
SET `cost_unit_snapshot` = (
  SELECT CAST(COALESCE(json_extract(service.value, '$.costPrice'), 0) AS INTEGER)
  FROM `projects`, json_each(`projects`.`payload`, '$.services') AS service
  WHERE `projects`.`id` = `service_records`.`project_id`
    AND CAST(json_extract(service.value, '$.id') AS INTEGER) = `service_records`.`service_id`
),
`cost_amount_snapshot` = (
  SELECT CAST(COALESCE(json_extract(service.value, '$.costPrice'), 0) AS INTEGER) *
    CAST(COALESCE(json_extract(`service_records`.`payload`, '$.data.quantity'), 1) AS INTEGER)
  FROM `projects`, json_each(`projects`.`payload`, '$.services') AS service
  WHERE `projects`.`id` = `service_records`.`project_id`
    AND CAST(json_extract(service.value, '$.id') AS INTEGER) = `service_records`.`service_id`
),
`profit_rate_basis_points` = CASE
  WHEN COALESCE(`unit_price_snapshot`, 0) > 0 THEN ROUND(
    (`unit_price_snapshot` - (
      SELECT CAST(COALESCE(json_extract(service.value, '$.costPrice'), 0) AS INTEGER)
      FROM `projects`, json_each(`projects`.`payload`, '$.services') AS service
      WHERE `projects`.`id` = `service_records`.`project_id`
        AND CAST(json_extract(service.value, '$.id') AS INTEGER) = `service_records`.`service_id`
    )) * 10000.0 / `unit_price_snapshot`
  )
  ELSE 0
END
WHERE `status` = '已完成';
