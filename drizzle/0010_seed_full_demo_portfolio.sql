INSERT OR IGNORE INTO `service_catalog` (`id`,`name`,`default_unit`,`category`,`enabled`) VALUES
(1,'EAP大使培训','场','培训',1),
(2,'心理讲座','场','活动',1),
(3,'心理团辅','场','活动',1),
(4,'线上咨询','人次','心理咨询',1),
(5,'线下咨询','人次','心理咨询',1),
(6,'驻场咨询','天','心理咨询',1),
(7,'心理测评','人次','测评',1),
(8,'EAP宣传','期','宣传',1);

WITH RECURSIVE demo_project(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM demo_project WHERE n < 10
)
INSERT OR IGNORE INTO `projects` (`id`,`payload`,`version`,`is_demo`,`updated_at`)
SELECT
  920000 + n,
  json_object(
    'id', 920000 + n,
    'name', '【示例】' || CASE n
      WHEN 1 THEN '星海智造员工心理关爱项目'
      WHEN 2 THEN '滨江科技人才EAP服务项目'
      WHEN 3 THEN '城市能源职工心理支持项目'
      WHEN 4 THEN '新城轨道员工关怀项目'
      WHEN 5 THEN '云帆金融组织韧性项目'
      WHEN 6 THEN '远航物流一线员工EAP项目'
      WHEN 7 THEN '青禾医药心理健康促进项目'
      WHEN 8 THEN '启明教育教职工关爱项目'
      WHEN 9 THEN '华彩零售员工幸福力项目'
      ELSE '卓越通信心理赋能项目'
    END,
    'manager', CASE n % 5
      WHEN 0 THEN '陈晨'
      WHEN 1 THEN '李明'
      WHEN 2 THEN '王芳'
      WHEN 3 THEN '张强'
      ELSE '刘洋'
    END,
    'status', CASE WHEN n IN (4,9) THEN '待启动' WHEN n IN (5,10) THEN '已完成' ELSE '执行中' END,
    'risk', '正常',
    'start', CASE WHEN n <= 5 THEN '2026-01-01' ELSE '2026-04-01' END,
    'end', CASE WHEN n <= 5 THEN '2026-12-31' ELSE '2027-03-31' END,
    'total', 660500,
    'contract', printf('DEMO-PORTFOLIO-2026-%02d', n),
    'services', json_array(
      json_object('id',(920000+n)*100+1,'name','EAP大使培训','unit','场','quantity',10,'completed',0,'unitPrice',12000,'costPrice',7200),
      json_object('id',(920000+n)*100+2,'name','心理讲座','unit','场','quantity',20,'completed',0,'unitPrice',6000,'costPrice',3500),
      json_object('id',(920000+n)*100+3,'name','心理团辅','unit','场','quantity',15,'completed',0,'unitPrice',8500,'costPrice',5000),
      json_object('id',(920000+n)*100+4,'name','线上咨询','unit','人次','quantity',80,'completed',0,'unitPrice',500,'costPrice',280),
      json_object('id',(920000+n)*100+5,'name','线下咨询','unit','人次','quantity',50,'completed',0,'unitPrice',800,'costPrice',450),
      json_object('id',(920000+n)*100+6,'name','驻场咨询','unit','天','quantity',30,'completed',0,'unitPrice',3500,'costPrice',2200),
      json_object('id',(920000+n)*100+7,'name','心理测评','unit','人次','quantity',300,'completed',0,'unitPrice',200,'costPrice',80),
      json_object('id',(920000+n)*100+8,'name','EAP宣传','unit','期','quantity',12,'completed',0,'unitPrice',4000,'costPrice',1800)
    )
  ),
  1,
  1,
  CURRENT_TIMESTAMP
FROM demo_project;

INSERT INTO `project_versions` (`project_id`,`version`,`payload`,`changed_by`)
SELECT `id`,1,`payload`,'示例数据'
FROM `projects`
WHERE `id` BETWEEN 920001 AND 920010
  AND NOT EXISTS (
    SELECT 1 FROM `project_versions`
    WHERE `project_versions`.`project_id`=`projects`.`id`
      AND `project_versions`.`version`=1
  );

WITH RECURSIVE demo_record(seq) AS (
  SELECT 1
  UNION ALL
  SELECT seq + 1 FROM demo_record WHERE seq < 200
),
record_values AS (
  SELECT
    seq,
    920000 + ((seq - 1) % 10) + 1 AS project_id,
    ((seq - 1) % 8) + 1 AS catalog_id,
    date('2026-07-29', '-' || ((seq * 3) % 180) || ' days') AS service_date,
    CASE ((seq - 1) % 8) + 1
      WHEN 1 THEN '培训活动记录'
      WHEN 2 THEN '讲座／团辅活动记录'
      WHEN 3 THEN '讲座／团辅活动记录'
      WHEN 4 THEN '心理咨询台账'
      WHEN 5 THEN '心理咨询台账'
      WHEN 6 THEN '驻场服务记录'
      WHEN 7 THEN '心理测评记录'
      ELSE 'EAP宣传记录'
    END AS record_type,
    CASE ((seq - 1) % 8) + 1
      WHEN 1 THEN 12000 WHEN 2 THEN 6000 WHEN 3 THEN 8500 WHEN 4 THEN 500
      WHEN 5 THEN 800 WHEN 6 THEN 3500 WHEN 7 THEN 200 ELSE 4000
    END AS unit_price,
    CASE ((seq - 1) % 8) + 1
      WHEN 1 THEN 7200 WHEN 2 THEN 3500 WHEN 3 THEN 5000 WHEN 4 THEN 280
      WHEN 5 THEN 450 WHEN 6 THEN 2200 WHEN 7 THEN 80 ELSE 1800
    END AS unit_cost,
    CASE WHEN ((seq - 1) % 8) + 1 = 7 THEN 10 ELSE 1 END AS quantity,
    CASE WHEN seq % 20 = 0 THEN '待审核' ELSE '已完成' END AS status
  FROM demo_record
)
INSERT OR IGNORE INTO `service_records` (
  `id`,`project_id`,`service_id`,`record_type`,`service_date`,`payload`,`status`,
  `unit_price_snapshot`,`amount_snapshot`,`cost_unit_snapshot`,`cost_amount_snapshot`,
  `profit_rate_basis_points`,`created_at`,`updated_at`,`approved_at`
)
SELECT
  9200000 + seq,
  project_id,
  project_id * 100 + catalog_id,
  record_type,
  service_date,
  json_object(
    'type', record_type,
    'data', json_object(
      'source', CASE WHEN seq % 4 = 0 THEN '外部链接填写' ELSE '项目经理填写' END,
      'projectId', project_id,
      'serviceId', project_id * 100 + catalog_id,
      'recordType', record_type,
      'provider', CASE catalog_id
        WHEN 1 THEN '示例培训师'
        WHEN 2 THEN '示例讲师'
        WHEN 3 THEN '示例团辅师'
        WHEN 4 THEN '线上咨询师'
        WHEN 5 THEN '线下咨询师'
        WHEN 6 THEN '驻场咨询师'
        WHEN 7 THEN '测评执行组'
        ELSE 'EAP运营组'
      END,
      'date', service_date,
      'quantity', quantity,
      'topic', CASE catalog_id
        WHEN 1 THEN 'EAP大使识别与转介技能培训'
        WHEN 2 THEN '压力管理与心理韧性讲座'
        WHEN 3 THEN '团队沟通与协作心理团辅'
        WHEN 7 THEN '员工心理健康测评'
        WHEN 8 THEN '心理健康主题宣传'
        ELSE NULL
      END,
      'participants', CASE WHEN catalog_id IN (1,2,3,7,8) THEN 20 + (seq % 60) ELSE NULL END,
      'location', CASE WHEN catalog_id IN (1,2,3,6) THEN '客户企业活动场地' ELSE NULL END,
      'method', CASE catalog_id WHEN 4 THEN '线上视频' WHEN 5 THEN '线下面询' WHEN 6 THEN '驻场面询' ELSE NULL END,
      'duration', CASE WHEN catalog_id IN (4,5,6) THEN 50 ELSE NULL END,
      'summary', printf('第%03d条示例服务记录，内容完整，可用于筛选、审核、进度和利润统计演示。', seq)
    ),
    'uploaded', json_array()
  ),
  status,
  CASE WHEN status='已完成' THEN unit_price ELSE NULL END,
  CASE WHEN status='已完成' THEN unit_price * quantity ELSE NULL END,
  CASE WHEN status='已完成' THEN unit_cost ELSE NULL END,
  CASE WHEN status='已完成' THEN unit_cost * quantity ELSE NULL END,
  CASE WHEN status='已完成' THEN ROUND((unit_price-unit_cost)*10000.0/unit_price) ELSE NULL END,
  service_date || ' 09:00:00',
  service_date || ' 17:00:00',
  CASE WHEN status='已完成' THEN service_date || 'T17:10:00.000Z' ELSE NULL END
FROM record_values;
