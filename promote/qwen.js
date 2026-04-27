
1. Source Scoring Agent
职责：评估内容来源（Source）的质量、历史表现、可靠性、潜在风险（如抄袭、低质、政治敏感等）。
输入：source_url, source_metadata (如网站域名、作者信息、历史文章链接等)。
输出：source_id, quality_score, stability_score, risk_score, overall_trustworthiness_score, scoring_details。
实现：
外部工具：
数据库查询：查询历史来源评分记录。
URL 分析库：分析 URL 结构、域名信誉（可集成第三方信誉 API）。
网页抓取：获取网站 About 页、Contact 页信息。
搜索引擎：搜索该来源的相关负面新闻或评价。
LLM 角色：分析收集到的多维度信息，综合判断并给出量化评分和理由。
逻辑：Agent 调用工具收集信息，将信息整理后发送给 LLM，LLM 返回结构化的评分和分析。
2. Ingestion Agent
职责：从原始 URL 获取内容，进行清洗、去重、结构化处理并存入数据库。
输入：source_url, article_id, expected_language (可选)。
输出：article_id, cleaned_content, raw_html (可选), title, publish_date, author, images_urls (提取), status (success/error), ingestion_log。
实现：
外部工具：
网页抓取库 (如 requests, scrapy)。
HTML 解析库 (如 BeautifulSoup, lxml)。
内容提取库 (如 newspaper3k, readability-lxml)。
数据库 CRUD：写入/更新文章记录。
去重算法 (如 SimHash, MinHash)：与已有内容对比。
LLM 角色：可选，用于高级内容清洗或理解复杂布局。
逻辑：Agent 使用抓取和解析工具获取内容，执行去重检查，清洗后将结构化数据存入数据库，并更新文章状态。