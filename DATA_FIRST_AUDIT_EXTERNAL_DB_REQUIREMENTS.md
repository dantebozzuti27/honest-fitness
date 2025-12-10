# Data-First Audit: External Database Requirements

This file contains issues from the DATA_FIRST_AUDIT.md that require databases or infrastructure outside of Supabase.

## Issue 7: Missing Data Warehouse

**Problem:** All data stored in operational database (Supabase). No separate analytical data warehouse for complex queries, aggregations, or historical analysis.

**Action Plan:** Implement data warehouse (BigQuery, Snowflake, or Redshift) with ETL pipeline. Replicate operational data to warehouse for analytics without impacting production performance.

**Why External:** Requires separate analytical database optimized for OLAP workloads, not OLTP.

**Implementation Options:**
1. **BigQuery** (Google Cloud)
   - Serverless, auto-scaling
   - Excellent for analytics
   - Easy integration with Supabase via scheduled exports
   - Cost: Pay per query

2. **Snowflake**
   - Cloud-native data warehouse
   - Excellent performance and scalability
   - Good for multi-cloud scenarios
   - Cost: Pay per compute hour

3. **Amazon Redshift**
   - AWS-native solution
   - Good for AWS ecosystem integration
   - Cost: Pay per cluster hour

4. **PostgreSQL-based (Supabase-compatible)**
   - Could use separate Supabase project as warehouse
   - Less optimal but keeps everything in Supabase ecosystem
   - Cost: Additional Supabase project cost

**Recommended Approach:**
- Start with BigQuery for cost-effectiveness and ease of setup
- Set up daily ETL jobs to replicate data from Supabase
- Use dbt for transformations
- Implement incremental loads to minimize costs

**Deferred Until:** Phase 2 (Months 4-6) when analytics workload justifies separate warehouse

---

## Related External Infrastructure

### Issue 8: No Data Archival Strategy (Partial)
**Note:** While archival logic can be implemented in Supabase, cold storage requires external object storage (S3, GCS, Azure Blob).

**External Component:** Object storage for cold data (2+ years old)
- AWS S3 Glacier
- Google Cloud Storage Coldline
- Azure Blob Archive

---

## Summary

**Total Issues Requiring External Databases:** 1 (Issue 7)
**Total Issues Requiring External Infrastructure:** 1 (Issue 8 - partial, for cold storage)

These will be implemented in Phase 2 when the data volume and analytics requirements justify the additional infrastructure and costs.

