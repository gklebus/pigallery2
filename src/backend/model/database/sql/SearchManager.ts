import {AutoCompleteItem} from '../../../../common/entities/AutoCompleteItem';
import {ISearchManager} from '../interfaces/ISearchManager';
import {SearchResultDTO} from '../../../../common/entities/SearchResultDTO';
import {SQLConnection} from './SQLConnection';
import {PhotoEntity} from './enitites/PhotoEntity';
import {DirectoryEntity} from './enitites/DirectoryEntity';
import {MediaEntity} from './enitites/MediaEntity';
import {PersonEntry} from './enitites/PersonEntry';
import {FaceRegionEntry} from './enitites/FaceRegionEntry';
import {Brackets, SelectQueryBuilder, WhereExpression} from 'typeorm';
import {Config} from '../../../../common/config/private/Config';
import {
  ANDSearchQuery,
  DistanceSearch,
  FromDateSearch,
  MaxRatingSearch,
  MaxResolutionSearch,
  MinRatingSearch,
  MinResolutionSearch,
  OrientationSearch,
  ORSearchQuery,
  SearchListQuery,
  SearchQueryDTO,
  SearchQueryTypes,
  SomeOfSearchQuery,
  TextSearch,
  TextSearchQueryMatchTypes,
  ToDateSearch
} from '../../../../common/entities/SearchQueryDTO';
import {GalleryManager} from './GalleryManager';
import {ObjectManagers} from '../../ObjectManagers';
import {Utils} from '../../../../common/Utils';
import {PhotoDTO} from '../../../../common/entities/PhotoDTO';
import {DatabaseType} from '../../../../common/config/private/PrivateConfig';

export class SearchManager implements ISearchManager {

  private static autoCompleteItemsUnique(array: Array<AutoCompleteItem>): Array<AutoCompleteItem> {
    const a = array.concat();
    for (let i = 0; i < a.length; ++i) {
      for (let j = i + 1; j < a.length; ++j) {
        if (a[i].equals(a[j])) {
          a.splice(j--, 1);
        }
      }
    }

    return a;
  }

  async autocomplete(text: string, type: SearchQueryTypes): Promise<AutoCompleteItem[]> {

    const connection = await SQLConnection.getConnection();

    let result: AutoCompleteItem[] = [];
    const photoRepository = connection.getRepository(PhotoEntity);
    const mediaRepository = connection.getRepository(MediaEntity);
    const personRepository = connection.getRepository(PersonEntry);
    const directoryRepository = connection.getRepository(DirectoryEntity);


    if (type === SearchQueryTypes.any_text || type === SearchQueryTypes.keyword) {
      (await photoRepository
        .createQueryBuilder('photo')
        .select('DISTINCT(photo.metadata.keywords)')
        .where('photo.metadata.keywords LIKE :text COLLATE utf8_general_ci', {text: '%' + text + '%'})
        .limit(Config.Client.Search.AutoComplete.maxItemsPerCategory)
        .getRawMany())
        .map((r): Array<string> => (r.metadataKeywords as string).split(',') as Array<string>)
        .forEach((keywords): void => {
          result = result.concat(this.encapsulateAutoComplete(keywords
            .filter((k): boolean => k.toLowerCase().indexOf(text.toLowerCase()) !== -1), SearchQueryTypes.keyword));
        });
    }

    if (type === SearchQueryTypes.any_text || type === SearchQueryTypes.person) {
      result = result.concat(this.encapsulateAutoComplete((await personRepository
        .createQueryBuilder('person')
        .select('DISTINCT(person.name)')
        .where('person.name LIKE :text COLLATE utf8_general_ci', {text: '%' + text + '%'})
        .limit(Config.Client.Search.AutoComplete.maxItemsPerCategory)
        .orderBy('person.name')
        .getRawMany())
        .map(r => r.name), SearchQueryTypes.person));
    }

    if (type === SearchQueryTypes.any_text || type === SearchQueryTypes.position || type === SearchQueryTypes.distance) {
      (await photoRepository
        .createQueryBuilder('photo')
        .select('photo.metadata.positionData.country as country, ' +
          'photo.metadata.positionData.state as state, photo.metadata.positionData.city as city')
        .where('photo.metadata.positionData.country LIKE :text COLLATE utf8_general_ci', {text: '%' + text + '%'})
        .orWhere('photo.metadata.positionData.state LIKE :text COLLATE utf8_general_ci', {text: '%' + text + '%'})
        .orWhere('photo.metadata.positionData.city LIKE :text COLLATE utf8_general_ci', {text: '%' + text + '%'})
        .groupBy('photo.metadata.positionData.country, photo.metadata.positionData.state, photo.metadata.positionData.city')
        .limit(Config.Client.Search.AutoComplete.maxItemsPerCategory)
        .getRawMany())
        .filter((pm): boolean => !!pm)
        .map((pm): Array<string> => [pm.city || '', pm.country || '', pm.state || ''] as Array<string>)
        .forEach((positions): void => {
          result = result.concat(this.encapsulateAutoComplete(positions
              .filter((p): boolean => p.toLowerCase().indexOf(text.toLowerCase()) !== -1),
            type === SearchQueryTypes.distance ? type : SearchQueryTypes.position));
        });
    }

    if (type === SearchQueryTypes.any_text || type === SearchQueryTypes.file_name) {
      result = result.concat(this.encapsulateAutoComplete((await mediaRepository
        .createQueryBuilder('media')
        .select('DISTINCT(media.name)')
        .where('media.name LIKE :text COLLATE utf8_general_ci', {text: '%' + text + '%'})
        .limit(Config.Client.Search.AutoComplete.maxItemsPerCategory)
        .getRawMany())
        .map(r => r.name), SearchQueryTypes.file_name));
    }

    if (type === SearchQueryTypes.any_text || type === SearchQueryTypes.caption) {
      result = result.concat(this.encapsulateAutoComplete((await photoRepository
        .createQueryBuilder('media')
        .select('DISTINCT(media.metadata.caption) as caption')
        .where('media.metadata.caption LIKE :text COLLATE utf8_general_ci', {text: '%' + text + '%'})
        .limit(Config.Client.Search.AutoComplete.maxItemsPerCategory)
        .getRawMany())
        .map(r => r.caption), SearchQueryTypes.caption));
    }

    if (type === SearchQueryTypes.any_text || type === SearchQueryTypes.directory) {
      result = result.concat(this.encapsulateAutoComplete((await directoryRepository
        .createQueryBuilder('dir')
        .select('DISTINCT(dir.name)')
        .where('dir.name LIKE :text COLLATE utf8_general_ci', {text: '%' + text + '%'})
        .limit(Config.Client.Search.AutoComplete.maxItemsPerCategory)
        .getRawMany())
        .map(r => r.name), SearchQueryTypes.directory));
    }

    return SearchManager.autoCompleteItemsUnique(result);
  }

  async search(queryIN: SearchQueryDTO): Promise<SearchResultDTO> {
    let query = this.flattenSameOfQueries(queryIN);
    query = await this.getGPSData(query);
    const connection = await SQLConnection.getConnection();

    const result: SearchResultDTO = {
      searchQuery: queryIN,
      directories: [],
      media: [],
      metaFile: [],
      resultOverflow: false
    };


    const sqlQuery = await connection.getRepository(MediaEntity).createQueryBuilder('media')
      .innerJoin((q): any => {
          const subQuery = q.from(MediaEntity, 'media')
            .select('distinct media.id')
            .limit(Config.Client.Search.maxMediaResult + 1);

          subQuery.leftJoin('media.directory', 'directory')
            .where(this.buildWhereQuery(query));

          return subQuery;
        },
        'innerMedia',
        'media.id=innerMedia.id')
      .leftJoinAndSelect('media.directory', 'directory')
      .leftJoinAndSelect('media.metadata.faces', 'faces')
      .leftJoinAndSelect('faces.person', 'person');


    result.media = await this.loadMediaWithFaces(sqlQuery);

    if (result.media.length > Config.Client.Search.maxMediaResult) {
      result.resultOverflow = true;
    }

    /* result.directories = await connection
       .getRepository(DirectoryEntity)
       .createQueryBuilder('dir')
       .where('dir.name LIKE :text COLLATE utf8_general_ci', {text: '%' + text + '%'})
       .limit(Config.Client.Search.maxMediaResult + 1)
       .getMany();

    if (result.directories.length > Config.Client.Search.maxDirectoryResult) {
      result.resultOverflow = true;
    }*/

    return result;
  }

  public async getRandomPhoto(query: SearchQueryDTO): Promise<PhotoDTO> {
    const connection = await SQLConnection.getConnection();
    const sqlQuery: SelectQueryBuilder<PhotoEntity> = connection
      .getRepository(PhotoEntity)
      .createQueryBuilder('media')
      .innerJoinAndSelect('media.directory', 'directory')
      .where(this.buildWhereQuery(query));


    if (Config.Server.Database.type === DatabaseType.mysql) {
      return await sqlQuery.groupBy('RAND(), media.id').limit(1).getOne();
    }
    return await sqlQuery.groupBy('RANDOM()').limit(1).getOne();

  }

  private async getGPSData(query: SearchQueryDTO): Promise<SearchQueryDTO> {
    if ((query as ANDSearchQuery | ORSearchQuery).list) {
      for (let i = 0; i < (query as ANDSearchQuery | ORSearchQuery).list.length; ++i) {
        (query as ANDSearchQuery | ORSearchQuery).list[i] =
          await this.getGPSData((query as ANDSearchQuery | ORSearchQuery).list[i]);
      }
    }
    if (query.type === SearchQueryTypes.distance && (query as DistanceSearch).from.text) {
      (query as DistanceSearch).from.GPSData =
        await ObjectManagers.getInstance().LocationManager.getGPSData((query as DistanceSearch).from.text);
    }
    return query;
  }

  private buildWhereQuery(query: SearchQueryDTO, paramCounter = {value: 0}): Brackets {
    switch (query.type) {
      case SearchQueryTypes.AND:
        return new Brackets((q): any => {
          (query as ANDSearchQuery).list.forEach((sq): any => q.andWhere(this.buildWhereQuery(sq, paramCounter)));
          return q;
        });
      case SearchQueryTypes.OR:
        return new Brackets((q): any => {
          (query as ANDSearchQuery).list.forEach((sq): any => q.orWhere(this.buildWhereQuery(sq, paramCounter)));
          return q;
        });


      case SearchQueryTypes.distance:
        /**
         * This is a best effort calculation, not fully accurate in order to have higher performance.
         * see: https://stackoverflow.com/a/50506609
         */
        const earth = 6378.137;  // radius of the earth in kilometer
        const latDelta = (1 / ((2 * Math.PI / 360) * earth));  // 1 km in degree
        const lonDelta = (1 / ((2 * Math.PI / 360) * earth));  // 1 km in degree

        // TODO: properly handle latitude / longitude boundaries
        const trimRange = (value: number, min: number, max: number): number => {
          return Math.min(Math.max(value, min), max);
        };

        const minLat = trimRange((query as DistanceSearch).from.GPSData.latitude -
          ((query as DistanceSearch).distance * latDelta), -90, 90);
        const maxLat = trimRange((query as DistanceSearch).from.GPSData.latitude +
          ((query as DistanceSearch).distance * latDelta), -90, 90);
        const minLon = trimRange((query as DistanceSearch).from.GPSData.longitude -
          ((query as DistanceSearch).distance * lonDelta) / Math.cos(minLat * (Math.PI / 180)), -180, 180);
        const maxLon = trimRange((query as DistanceSearch).from.GPSData.longitude +
          ((query as DistanceSearch).distance * lonDelta) / Math.cos(maxLat * (Math.PI / 180)), -180, 180);


        return new Brackets((q): any => {
          const textParam: any = {};
          paramCounter.value++;
          textParam['maxLat' + paramCounter.value] = maxLat;
          textParam['minLat' + paramCounter.value] = minLat;
          textParam['maxLon' + paramCounter.value] = maxLon;
          textParam['minLon' + paramCounter.value] = minLon;
          if (!(query as DistanceSearch).negate) {
            q.where(`media.metadata.positionData.GPSData.latitude < :maxLat${paramCounter.value}`, textParam);
            q.andWhere(`media.metadata.positionData.GPSData.latitude > :minLat${paramCounter.value}`, textParam);
            q.andWhere(`media.metadata.positionData.GPSData.longitude < :maxLon${paramCounter.value}`, textParam);
            q.andWhere(`media.metadata.positionData.GPSData.longitude > :minLon${paramCounter.value}`, textParam);
          } else {
            q.where(`media.metadata.positionData.GPSData.latitude > :maxLat${paramCounter.value}`, textParam);
            q.orWhere(`media.metadata.positionData.GPSData.latitude < :minLat${paramCounter.value}`, textParam);
            q.orWhere(`media.metadata.positionData.GPSData.longitude > :maxLon${paramCounter.value}`, textParam);
            q.orWhere(`media.metadata.positionData.GPSData.longitude < :minLon${paramCounter.value}`, textParam);
          }
          return q;
        });

      case SearchQueryTypes.from_date:
        return new Brackets((q): any => {
          if (typeof (query as FromDateSearch).value === 'undefined') {
            throw new Error('Invalid search query: Date Query should contain from value');
          }
          const relation = (query as TextSearch).negate ? '<' : '>=';

          const textParam: any = {};
          textParam['from' + paramCounter.value] = (query as FromDateSearch).value;
          q.where(`media.metadata.creationDate ${relation} :from${paramCounter.value}`, textParam);


          paramCounter.value++;
          return q;
        });

      case SearchQueryTypes.to_date:
        return new Brackets((q): any => {
          if (typeof (query as ToDateSearch).value === 'undefined') {
            throw new Error('Invalid search query: Date Query should contain to value');
          }
          const relation = (query as TextSearch).negate ? '>' : '<=';

          const textParam: any = {};
          textParam['to' + paramCounter.value] = (query as ToDateSearch).value;
          q.where(`media.metadata.creationDate ${relation} :to${paramCounter.value}`, textParam);

          paramCounter.value++;
          return q;
        });

      case SearchQueryTypes.min_rating:
        return new Brackets((q): any => {
          if (typeof (query as MinRatingSearch).value === 'undefined') {
            throw new Error('Invalid search query: Rating Query should contain minvalue');
          }

          const relation = (query as TextSearch).negate ? '<' : '>=';

          const textParam: any = {};
          textParam['min' + paramCounter.value] = (query as MinRatingSearch).value;
          q.where(`media.metadata.rating ${relation}  :min${paramCounter.value}`, textParam);

          paramCounter.value++;
          return q;
        });
      case SearchQueryTypes.max_rating:
        return new Brackets((q): any => {
          if (typeof (query as MaxRatingSearch).value === 'undefined') {
            throw new Error('Invalid search query: Rating Query should contain  max value');
          }

          const relation = (query as TextSearch).negate ? '>' : '<=';

          if (typeof (query as MaxRatingSearch).value !== 'undefined') {
            const textParam: any = {};
            textParam['max' + paramCounter.value] = (query as MaxRatingSearch).value;
            q.where(`media.metadata.rating ${relation}  :max${paramCounter.value}`, textParam);
          }
          paramCounter.value++;
          return q;
        });

      case SearchQueryTypes.min_resolution:
        return new Brackets((q): any => {
          if (typeof (query as MinResolutionSearch).value === 'undefined') {
            throw new Error('Invalid search query: Resolution Query should contain min value');
          }

          const relation = (query as TextSearch).negate ? '<' : '>=';

          const textParam: any = {};
          textParam['min' + paramCounter.value] = (query as MinResolutionSearch).value * 1000 * 1000;
          q.where(`media.metadata.size.width * media.metadata.size.height ${relation} :min${paramCounter.value}`, textParam);


          paramCounter.value++;
          return q;
        });

      case SearchQueryTypes.max_resolution:
        return new Brackets((q): any => {
          if (typeof (query as MaxResolutionSearch).value === 'undefined') {
            throw new Error('Invalid search query: Rating Query should contain min or max value');
          }

          const relation = (query as TextSearch).negate ? '>' : '<=';

          const textParam: any = {};
          textParam['max' + paramCounter.value] = (query as MaxResolutionSearch).value * 1000 * 1000;
          q.where(`media.metadata.size.width * media.metadata.size.height ${relation} :max${paramCounter.value}`, textParam);

          paramCounter.value++;
          return q;
        });

      case SearchQueryTypes.orientation:
        return new Brackets((q): any => {
          if ((query as OrientationSearch).landscape) {
            q.where('media.metadata.size.width >= media.metadata.size.height');
          } else {
            q.where('media.metadata.size.width <= media.metadata.size.height');
          }
          paramCounter.value++;
          return q;
        });


      case SearchQueryTypes.SOME_OF:
        throw new Error('Some of not supported');

    }

    return new Brackets((q: WhereExpression) => {

      const createMatchString = (str: string): string => {
        return (query as TextSearch).matchType === TextSearchQueryMatchTypes.exact_match ? str : `%${str}%`;
      };

      const LIKE = (query as TextSearch).negate ? 'NOT LIKE' : 'LIKE';
      // if the expression is negated, we use AND instead of OR as nowhere should that match
      const whereFN = (query as TextSearch).negate ? 'andWhere' : 'orWhere';
      const whereFNRev = (query as TextSearch).negate ? 'orWhere' : 'andWhere';

      const textParam: any = {};
      paramCounter.value++;
      textParam['text' + paramCounter.value] = createMatchString((query as TextSearch).text);

      if (query.type === SearchQueryTypes.any_text ||
        query.type === SearchQueryTypes.directory) {
        const dirPathStr = ((query as TextSearch).text).replace(new RegExp('\\\\', 'g'), '/');


        textParam['fullPath' + paramCounter.value] = createMatchString(dirPathStr);
        q[whereFN](`directory.path ${LIKE} :fullPath${paramCounter.value} COLLATE utf8_general_ci`,
          textParam);

        const directoryPath = GalleryManager.parseRelativeDirePath(dirPathStr);
        q[whereFN](new Brackets((dq): any => {
          textParam['dirName' + paramCounter.value] = createMatchString(directoryPath.name);
          dq[whereFNRev](`directory.name ${LIKE} :dirName${paramCounter.value} COLLATE utf8_general_ci`,
            textParam);
          if (dirPathStr.includes('/')) {
            textParam['parentName' + paramCounter.value] = createMatchString(directoryPath.parent);
            dq[whereFNRev](`directory.path ${LIKE} :parentName${paramCounter.value} COLLATE utf8_general_ci`,
              textParam);
          }
          return dq;
        }));
      }

      if (query.type === SearchQueryTypes.any_text || query.type === SearchQueryTypes.file_name) {
        q[whereFN](`media.name ${LIKE} :text${paramCounter.value} COLLATE utf8_general_ci`,
          textParam);
      }

      if (query.type === SearchQueryTypes.any_text || query.type === SearchQueryTypes.caption) {
        q[whereFN](`media.metadata.caption ${LIKE} :text${paramCounter.value} COLLATE utf8_general_ci`,
          textParam);
      }

      if (query.type === SearchQueryTypes.any_text || query.type === SearchQueryTypes.position) {
        q[whereFN](`media.metadata.positionData.country ${LIKE} :text${paramCounter.value} COLLATE utf8_general_ci`,
          textParam)
          [whereFN](`media.metadata.positionData.state ${LIKE} :text${paramCounter.value} COLLATE utf8_general_ci`,
          textParam)
          [whereFN](`media.metadata.positionData.city ${LIKE} :text${paramCounter.value} COLLATE utf8_general_ci`,
          textParam);
      }

      // Matching for array type fields
      const matchArrayField = (fieldName: string): void => {
        q[whereFN](new Brackets((qbr): void => {
          if ((query as TextSearch).matchType !== TextSearchQueryMatchTypes.exact_match) {
            qbr[whereFN](`${fieldName} ${LIKE} :text${paramCounter.value} COLLATE utf8_general_ci`,
              textParam);
          } else {
            qbr[whereFN](new Brackets((qb): void => {
              textParam['CtextC' + paramCounter.value] = `%,${(query as TextSearch).text},%`;
              textParam['Ctext' + paramCounter.value] = `%,${(query as TextSearch).text}`;
              textParam['textC' + paramCounter.value] = `${(query as TextSearch).text},%`;
              textParam['text_exact' + paramCounter.value] = `${(query as TextSearch).text}`;

              qb[whereFN](`${fieldName} ${LIKE} :CtextC${paramCounter.value} COLLATE utf8_general_ci`,
                textParam);
              qb[whereFN](`${fieldName} ${LIKE} :Ctext${paramCounter.value} COLLATE utf8_general_ci`,
                textParam);
              qb[whereFN](`${fieldName} ${LIKE} :textC${paramCounter.value} COLLATE utf8_general_ci`,
                textParam);
              qb[whereFN](`${fieldName} ${LIKE} :text_exact${paramCounter.value} COLLATE utf8_general_ci`,
                textParam);
            }));
          }
          if ((query as TextSearch).negate) {
            qbr.orWhere(`${fieldName} IS NULL`);
          }
        }));
      };


      if (query.type === SearchQueryTypes.any_text || query.type === SearchQueryTypes.person) {
        matchArrayField('media.metadata.persons');
      }

      if (query.type === SearchQueryTypes.any_text || query.type === SearchQueryTypes.keyword) {
        matchArrayField('media.metadata.keywords');
      }
      return q;
    });
  }

  private flattenSameOfQueries(query: SearchQueryDTO): SearchQueryDTO {
    switch (query.type) {
      case SearchQueryTypes.AND:
      case SearchQueryTypes.OR:
        return {
          type: query.type,
          list: (query as SearchListQuery).list.map((q): SearchQueryDTO => this.flattenSameOfQueries(q))
        } as SearchListQuery;
      case SearchQueryTypes.SOME_OF:
        const someOfQ = query as SomeOfSearchQuery;
        someOfQ.min = someOfQ.min || 1;

        if (someOfQ.min === 1) {
          return this.flattenSameOfQueries({
            type: SearchQueryTypes.OR,
            list: (someOfQ as SearchListQuery).list
          } as ORSearchQuery);
        }

        if (someOfQ.min === (query as SearchListQuery).list.length) {
          return this.flattenSameOfQueries({
            type: SearchQueryTypes.AND,
            list: (someOfQ as SearchListQuery).list
          } as ANDSearchQuery);
        }

        const combinations: SearchQueryDTO[][] = Utils.getAnyX(someOfQ.min, (query as SearchListQuery).list);


        return this.flattenSameOfQueries({
          type: SearchQueryTypes.OR,
          list: combinations.map((c): ANDSearchQuery => ({
            type: SearchQueryTypes.AND, list: c
          } as ANDSearchQuery))
        } as ORSearchQuery);

    }
    return query;
  }

  private encapsulateAutoComplete(values: string[], type: SearchQueryTypes): Array<AutoCompleteItem> {
    const res: AutoCompleteItem[] = [];
    values.forEach((value): void => {
      res.push(new AutoCompleteItem(value, type));
    });
    return res;
  }

  private async loadMediaWithFaces(query: SelectQueryBuilder<MediaEntity>): Promise<MediaEntity[]> {
    const rawAndEntities = await query.orderBy('media.id').getRawAndEntities();
    const media: MediaEntity[] = rawAndEntities.entities;

    let rawIndex = 0;
    for (const item of media) {

      if (rawAndEntities.raw[rawIndex].media_id !== item.id) {
        throw new Error('index mismatch');
      }

      // media without a face
      if (rawAndEntities.raw[rawIndex].faces_id === null) {
        delete item.metadata.faces;
        rawIndex++;
        continue;
      }

      // process all faces for one media
      item.metadata.faces = [];

      while (rawAndEntities.raw[rawIndex].media_id === item.id) {
        item.metadata.faces.push(FaceRegionEntry.fromRawToDTO(rawAndEntities.raw[rawIndex]) as any);
        rawIndex++;
        if (rawIndex >= rawAndEntities.raw.length) {
          return media;
        }
      }
    }
    return media;
  }
}
