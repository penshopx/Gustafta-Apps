ALTER TABLE lms_certificates
  ADD COLUMN IF NOT EXISTS course_title TEXT NOT NULL DEFAULT 'Kursus';

UPDATE lms_certificates cert
   SET course_title = course.title
  FROM lms_courses course
 WHERE cert.course_id = course.id
   AND (cert.course_title IS NULL OR cert.course_title = 'Kursus');

ALTER TABLE lms_certificates
  ALTER COLUMN course_id DROP NOT NULL;

DO $$
DECLARE fk_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'lms_certificates'::regclass
       AND contype = 'f'
       AND confdeltype = 'n'
       AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (course_id)%'
  ) THEN
    FOR fk_name IN
      SELECT conname
        FROM pg_constraint
       WHERE conrelid = 'lms_certificates'::regclass
         AND contype = 'f'
         AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (course_id)%'
    LOOP
      EXECUTE format('ALTER TABLE lms_certificates DROP CONSTRAINT %I', fk_name);
    END LOOP;

    ALTER TABLE lms_certificates
      ADD CONSTRAINT lms_certificates_course_id_fkey
      FOREIGN KEY (course_id) REFERENCES lms_courses(id) ON DELETE SET NULL;
  END IF;
END$$;